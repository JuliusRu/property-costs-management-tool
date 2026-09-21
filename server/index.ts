import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { db, q, CATEGORIES, DEFAULT_KEY, type Category, type AllocationKey } from "./db.js";
import { seedIfEmpty } from "./seed.js";
import { computeStatements } from "./allocation.js";
import { extractInvoice } from "./ai.js";
import { checkPassword, makeSession, requireLandlord } from "./auth.js";
import { sendMail } from "./mail.js";
import { statementPdf, eur } from "./pdf.js";

// pdf-parse is CommonJS; createRequire keeps it working under ESM.
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;

const app = express();
app.use(express.json({ limit: "1mb" }));
seedIfEmpty();

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.resolve("uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const APP_URL = () => (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
const num = (v: unknown) => Number.parseInt(String(v), 10);

// ---------- auth ----------
app.post("/api/login", (req, res) => {
  if (!checkPassword(String(req.body?.password ?? ""))) return res.status(401).json({ error: "wrong password" });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `session=${makeSession()}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=43200`);
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/me", (req, res, next) => requireLandlord(req, res, () => res.json({ role: "landlord" })));

// ---------- tenant portal (token-based, no login) ----------
app.get("/api/portal/:token", (req, res) => {
  const t = q.tenantByToken(req.params.token);
  if (!t) return res.status(404).json({ error: "not found" });
  const unit = q.unit(t.unit_id)!;
  const property = q.property(unit.property_id)!;
  const statements = q.statementsForTenant(t.id).map((s) => ({ ...s, lines: JSON.parse(s.lines_json), lines_json: undefined }));
  res.json({ tenant: { name: t.name, email: t.email, monthly_prepayment_cents: t.monthly_prepayment_cents }, unit, property, statements });
});
app.get("/api/portal/:token/invoice/:id/file", (req, res) => {
  const t = q.tenantByToken(req.params.token);
  const inv = q.invoice(num(req.params.id));
  if (!t || !inv || !inv.file_name) return res.status(404).end();
  const unit = q.unit(t.unit_id)!;
  if (unit.property_id !== inv.property_id) return res.status(403).end(); // tenant may only see invoices of their own building
  res.sendFile(path.join(UPLOAD_DIR, inv.file_name));
});

// everything below requires the landlord session
app.use("/api", requireLandlord);

// ---------- properties ----------
app.get("/api/properties", (_req, res) => {
  res.json(q.properties().map((p) => ({ ...p, units: q.units(p.id), tenants: q.tenants(p.id) })));
});
app.get("/api/meta", (_req, res) => res.json({ categories: CATEGORIES, default_key: DEFAULT_KEY }));

// ---------- invoices ----------
app.get("/api/properties/:id/invoices", (req, res) => {
  const year = req.query.year ? num(req.query.year) : undefined;
  res.json(q.invoices(num(req.params.id), year));
});

function insertInvoice(propertyId: number, b: Record<string, unknown>) {
  const category = (CATEGORIES as readonly string[]).includes(String(b.category)) ? (b.category as Category) : "other";
  const keys: AllocationKey[] = ["area", "persons", "units", "heating", "water"];
  const key = keys.includes(b.allocation_key as AllocationKey) ? (b.allocation_key as AllocationKey) : DEFAULT_KEY[category];
  const amount = Math.round(Number(b.amount_cents));
  if (!Number.isFinite(amount) || amount < 0) throw new Error("amount_cents invalid");
  for (const d of [b.period_start, b.period_end]) if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) throw new Error("period invalid");
  const r = db.prepare(
    `INSERT INTO invoices (property_id, provider, category, description, amount_cents, period_start, period_end, allocation_key, allocable, source, file_name, ai_confidence, ai_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(propertyId, String(b.provider ?? "").slice(0, 120), category, String(b.description ?? "").slice(0, 200), amount,
    String(b.period_start), String(b.period_end), key, b.allocable === false ? 0 : 1, String(b.source ?? "manual"),
    b.file_name ? String(b.file_name) : null, b.ai_confidence == null ? null : Number(b.ai_confidence), b.ai_notes ? String(b.ai_notes) : null);
  return q.invoice(Number(r.lastInsertRowid));
}

app.post("/api/properties/:id/invoices", (req, res) => {
  try { res.status(201).json(insertInvoice(num(req.params.id), req.body ?? {})); }
  catch (e) { res.status(400).json({ error: (e as Error).message }); }
});
app.patch("/api/invoices/:id", (req, res) => {
  const inv = q.invoice(num(req.params.id));
  if (!inv) return res.status(404).end();
  const b = req.body ?? {};
  const category = (CATEGORIES as readonly string[]).includes(b.category) ? b.category : inv.category;
  const keys = ["area", "persons", "units", "heating", "water"];
  const key = keys.includes(b.allocation_key) ? b.allocation_key : inv.allocation_key;
  db.prepare(`UPDATE invoices SET provider=?, category=?, description=?, amount_cents=?, period_start=?, period_end=?, allocation_key=?, allocable=? WHERE id=?`)
    .run(String(b.provider ?? inv.provider).slice(0, 120), category, String(b.description ?? inv.description ?? "").slice(0, 200),
      Math.round(Number(b.amount_cents ?? inv.amount_cents)), String(b.period_start ?? inv.period_start), String(b.period_end ?? inv.period_end),
      key, b.allocable === undefined ? inv.allocable : (b.allocable ? 1 : 0), inv.id);
  res.json(q.invoice(inv.id));
});
app.delete("/api/invoices/:id", (req, res) => {
  db.prepare("DELETE FROM invoices WHERE id = ?").run(num(req.params.id));
  res.status(204).end();
});
app.get("/api/invoices/:id/file", (req, res) => {
  const inv = q.invoice(num(req.params.id));
  if (!inv?.file_name) return res.status(404).end();
  res.sendFile(path.join(UPLOAD_DIR, inv.file_name));
});

async function extractFromBuffer(buf: Buffer, originalName: string, mime: string) {
  const safeName = `${Date.now()}-${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  writeFileSync(path.join(UPLOAD_DIR, safeName), buf);
  let extraction;
  if (mime === "application/pdf" || originalName.toLowerCase().endsWith(".pdf")) {
    const { text } = await pdfParse(buf);
    extraction = await extractInvoice({ text, fileName: originalName });
  } else if (mime.startsWith("image/")) {
    extraction = await extractInvoice({ imageBase64: buf.toString("base64"), mime, fileName: originalName });
  } else {
    throw new Error("unsupported file type — upload a PDF or image");
  }
  return { extraction, file_name: safeName };
}

// Upload one invoice → AI extraction → returned for review (not saved yet).
app.post("/api/properties/:id/invoices/extract", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file missing" });
  try { res.json(await extractFromBuffer(req.file.buffer, req.file.originalname, req.file.mimetype)); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// "Inbox sync": simulates the automated job that pulls provider invoices. Reads samples/ and books everything.
app.post("/api/properties/:id/invoices/sync", async (req, res) => {
  const propertyId = num(req.params.id);
  const dir = path.resolve("samples");
  if (!existsSync(dir)) return res.json({ imported: [] });
  const already = new Set(q.invoices(propertyId).map((i) => i.file_name?.replace(/^\d+-/, "")));
  const imported = [];
  const errors: string[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".pdf") && !already.has(f))) {
    try {
      const { extraction, file_name } = await extractFromBuffer(readFileSync(path.join(dir, f)), f, "application/pdf");
      imported.push(insertInvoice(propertyId, { ...extraction, source: "sync", file_name, ai_confidence: extraction.confidence, ai_notes: extraction.notes }));
    } catch (e) { errors.push(`${f}: ${(e as Error).message}`); }
  }
  res.json({ imported, errors });
});

// ---------- statements ----------
app.post("/api/properties/:id/statements/generate", (req, res) => {
  const propertyId = num(req.params.id);
  const year = num(req.body?.year);
  if (!Number.isFinite(year)) return res.status(400).json({ error: "year missing" });
  const results = computeStatements(q.units(propertyId), q.tenants(propertyId), q.invoices(propertyId, year), year);
  const up = db.prepare(
    `INSERT INTO statements (tenant_id, year, total_cents, prepaid_cents, balance_cents, lines_json) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, year) DO UPDATE SET total_cents=excluded.total_cents, prepaid_cents=excluded.prepaid_cents,
       balance_cents=excluded.balance_cents, lines_json=excluded.lines_json, created_at=datetime('now'), sent_at=NULL`
  );
  for (const s of results) up.run(s.tenant.id, year, s.total_cents, s.prepaid_cents, s.balance_cents, JSON.stringify(s.lines));
  res.json(q.statements(propertyId, year).map((s) => ({ ...s, lines: JSON.parse(s.lines_json), lines_json: undefined })));
});
app.get("/api/properties/:id/statements", (req, res) => {
  const year = num(req.query.year);
  res.json(q.statements(num(req.params.id), year).map((s) => ({ ...s, lines: JSON.parse(s.lines_json), lines_json: undefined })));
});

function buildTenantStatement(sid: number) {
  const s = q.statement(sid);
  if (!s) return null;
  const tenant = q.tenant(s.tenant_id)!, unit = q.unit(tenant.unit_id)!, property = q.property(unit.property_id)!;
  return { s, property, ts: { tenant, unit, year: s.year, lines: JSON.parse(s.lines_json), total_cents: s.total_cents, prepaid_cents: s.prepaid_cents, balance_cents: s.balance_cents } };
}

app.get("/api/statements/:id/pdf", async (req, res) => {
  const b = buildTenantStatement(num(req.params.id));
  if (!b) return res.status(404).end();
  const pdf = await statementPdf(b.property, b.ts, `${APP_URL()}/portal/${b.ts.tenant.portal_token}`);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Abrechnung-${b.s.year}-${b.ts.unit.label.replace(/\W+/g, "_")}.pdf"`);
  res.send(pdf);
});

app.post("/api/statements/:id/send", async (req, res) => {
  const b = buildTenantStatement(num(req.params.id));
  if (!b) return res.status(404).end();
  const portalUrl = `${APP_URL()}/portal/${b.ts.tenant.portal_token}`;
  try {
    const pdf = await statementPdf(b.property, b.ts, portalUrl);
    const bal = b.ts.balance_cents;
    await sendMail({
      to: { email: b.ts.tenant.email, name: b.ts.tenant.name },
      subject: `Betriebskostenabrechnung ${b.s.year} – ${b.property.name}, ${b.ts.unit.label}`,
      html: `<p>Guten Tag ${b.ts.tenant.name},</p>
<p>anbei erhalten Sie Ihre Betriebskostenabrechnung für ${b.s.year}.</p>
<p><strong>${bal > 0 ? `Nachzahlung: ${eur(bal)}` : `Guthaben: ${eur(-bal)}`}</strong></p>
<p>Jede Position können Sie mit Originalbeleg im Mieterportal nachvollziehen:<br><a href="${portalUrl}">${portalUrl}</a></p>
<p>Mit freundlichen Grüßen<br>Ihre Hausverwaltung</p>`,
      attachment: { name: `Betriebskostenabrechnung-${b.s.year}.pdf`, content: pdf },
    });
    db.prepare("UPDATE statements SET sent_at = datetime('now') WHERE id = ?").run(b.s.id);
    res.json({ ok: true, sent_at: q.statement(b.s.id)!.sent_at });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});

// ---------- static frontend (production) ----------
const dist = path.resolve("client/dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`api listening on :${port}`));
