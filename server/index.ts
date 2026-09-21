import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { db, q, CATEGORIES, DEFAULT_KEY, HEATING_TYPES, DOC_KINDS, newAccessCode, settingsOf, leaseOf, type Category, type AllocationKey, type Tenant, type HeatingType, type DocKind } from "./db.js";
import { seedIfEmpty, resetAndSeed } from "./seed.js";
import { computeStatements, occupiedMonths, RULES_VERSION } from "./allocation.js";
import { extractInvoice, extractLease, coerceLease, classifyDocument, heuristicClassify, type Extraction, type LeaseExtraction } from "./ai.js";
import { checkPassword, makeSession, requireLandlord, safeEqual, tenantIdFromSession } from "./auth.js";
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
  res.setHeader("Set-Cookie", `session=${makeSession("landlord")}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=43200`);
  res.json({ ok: true });
});
app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

// ---------- tenant login: e-mail + access code (the code is printed on the statement and in the mail) ----------
const loginHits = new Map<string, number[]>();
app.post("/api/tenant-login", (req, res) => {
  const ip = req.ip ?? "?", now = Date.now();
  const hits = (loginHits.get(ip) ?? []).filter((t) => now - t < 15 * 60_000);
  if (hits.length >= 20) return res.status(429).json({ error: "too many attempts — try again in 15 minutes" });
  hits.push(now); loginHits.set(ip, hits);
  const email = String(req.body?.email ?? "").trim();
  const code = String(req.body?.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = q.tenantByEmail(email).find((t) => t.access_code && safeEqual(t.access_code, code));
  if (!match) return res.status(401).json({ error: "wrong e-mail or access code" });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `tenant=${makeSession("tenant", String(match.id))}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=43200`);
  res.json({ ok: true });
});
app.post("/api/tenant-logout", (_req, res) => {
  res.setHeader("Set-Cookie", "tenant=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/me", (req, res, next) => requireLandlord(req, res, () => res.json({ role: "landlord" })));

// ---------- tenant portal (token-based, no login) ----------
function portalPayload(t: Tenant) {
  const unit = q.unit(t.unit_id)!;
  const property = q.property(unit.property_id)!;
  const statements = q.statementsForTenant(t.id).map((s) => ({ ...s, lines: JSON.parse(s.lines_json), lines_json: undefined }));
  return { tenant: { name: t.name, email: t.email, monthly_prepayment_cents: t.monthly_prepayment_cents }, unit, property, statements };
}
function tenantInvoiceFile(t: Tenant | undefined, invoiceId: number, res: express.Response) {
  const inv = q.invoice(invoiceId);
  if (!t || !inv || !inv.file_name) return res.status(404).end();
  const unit = q.unit(t.unit_id)!;
  if (unit.property_id !== inv.property_id) return res.status(403).end(); // tenant may only see invoices of their own building
  res.sendFile(path.join(UPLOAD_DIR, inv.file_name));
}
// "me" = logged in via e-mail + code; ":token" = magic link from the statement mail
app.get("/api/portal/me", (req, res) => {
  const id = tenantIdFromSession(req);
  const t = id ? q.tenant(id) : undefined;
  if (!t) return res.status(401).json({ error: "unauthorized" });
  res.json(portalPayload(t));
});
app.get("/api/portal/me/invoice/:id/file", (req, res) => {
  const id = tenantIdFromSession(req);
  tenantInvoiceFile(id ? q.tenant(id) : undefined, num(req.params.id), res);
});
app.get("/api/portal/:token", (req, res) => {
  const t = q.tenantByToken(req.params.token);
  if (!t) return res.status(404).json({ error: "not found" });
  res.json(portalPayload(t));
});
app.get("/api/portal/:token/invoice/:id/file", (req, res) => {
  tenantInvoiceFile(q.tenantByToken(req.params.token), num(req.params.id), res);
});

// ---------- public waitlist (landing page) ----------
const waitlistHits = new Map<string, number[]>();
app.post("/api/waitlist", (req, res) => {
  const ip = req.ip ?? "?";
  const now = Date.now();
  const hits = (waitlistHits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (hits.length >= 10) return res.status(429).json({ error: "too many requests" });
  hits.push(now); waitlistHits.set(ip, hits);
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return res.status(400).json({ error: "Please enter a valid e-mail address." });
  const units = Number.isFinite(Number(req.body?.units)) ? Math.max(0, Math.min(10000, Math.round(Number(req.body.units)))) : null;
  db.prepare("INSERT INTO waitlist (email, units) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET units = excluded.units").run(email, units);
  res.status(201).json({ ok: true });
});

// everything below requires the landlord session
app.use("/api", requireLandlord);

// ---------- properties ----------
app.get("/api/properties", (_req, res) => {
  res.json(q.properties().map((p) => ({ ...p, settings: settingsOf(p), settings_json: undefined, units: q.units(p.id), tenants: q.tenants(p.id).map((t) => ({ ...t, lease: leaseOf(t), lease_json: undefined })) })));
});
app.post("/api/properties", (req, res) => {
  const b = req.body ?? {};
  if (!b.name) return res.status(400).json({ error: "name missing" });
  const r = db.prepare("INSERT INTO properties (name, address, country, settings_json) VALUES (?, ?, 'DE', '{}')").run(String(b.name).slice(0, 120), String(b.address ?? "").slice(0, 200));
  res.status(201).json(q.property(Number(r.lastInsertRowid)));
});
app.delete("/api/properties/:id", (req, res) => {
  if (q.properties().length <= 1) return res.status(400).json({ error: "keep at least one building" });
  db.prepare("DELETE FROM properties WHERE id = ?").run(num(req.params.id));
  res.status(204).end();
});
app.get("/api/meta", (_req, res) => res.json({ categories: CATEGORIES, default_key: DEFAULT_KEY, heating_types: HEATING_TYPES, rules: RULES_VERSION }));
app.patch("/api/properties/:id/settings", (req, res) => {
  const p = q.property(num(req.params.id));
  if (!p) return res.status(404).end();
  const cur = settingsOf(p), b = req.body ?? {};
  const next = {
    heating_type: (HEATING_TYPES as readonly string[]).includes(b.heating_type) ? (b.heating_type as HeatingType) : cur.heating_type,
    consumption_share: Number.isFinite(Number(b.consumption_share)) ? Math.min(0.7, Math.max(0.5, Number(b.consumption_share))) : cur.consumption_share,
    hot_water_central: typeof b.hot_water_central === "boolean" ? b.hot_water_central : cur.hot_water_central,
    heizkv_exempt: typeof b.heizkv_exempt === "boolean" ? b.heizkv_exempt : cur.heizkv_exempt,
    heated_area_sqm: b.heated_area_sqm === null || b.heated_area_sqm === "" ? null : Number.isFinite(Number(b.heated_area_sqm)) ? Number(b.heated_area_sqm) : cur.heated_area_sqm,
  };
  db.prepare("UPDATE properties SET settings_json = ? WHERE id = ?").run(JSON.stringify(next), p.id);
  res.json(next);
});
app.get("/api/waitlist", (_req, res) => res.json(db.prepare("SELECT email, units, created_at FROM waitlist ORDER BY id DESC").all()));
// Demo helper: wipe everything and reseed so the flow can be shown again from scratch.
app.post("/api/reset", (_req, res) => { resetAndSeed(); res.json({ ok: true }); });

// ---------- building: property, units, tenants ----------
const isoOrNull = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const numOr = (v: unknown, d: number) => (v === undefined || v === null || v === "" ? d : Number(v));

app.patch("/api/properties/:id", (req, res) => {
  const p = q.property(num(req.params.id));
  if (!p) return res.status(404).end();
  const b = req.body ?? {};
  db.prepare("UPDATE properties SET name = ?, address = ? WHERE id = ?").run(String(b.name ?? p.name).slice(0, 120), String(b.address ?? p.address).slice(0, 200), p.id);
  res.json(q.property(p.id));
});
app.post("/api/properties/:id/units", (req, res) => {
  const b = req.body ?? {};
  if (!b.label) return res.status(400).json({ error: "label missing" });
  const ut = ["residential", "commercial", "garage"].includes(b.unit_type) ? b.unit_type : "residential";
  const r = db.prepare("INSERT INTO units (property_id, label, unit_type, area_sqm, persons, heating_kwh, water_m3) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(num(req.params.id), String(b.label).slice(0, 60), ut, numOr(b.area_sqm, 0), numOr(b.persons, 1), numOr(b.heating_kwh, 0), numOr(b.water_m3, 0));
  res.status(201).json(q.unit(Number(r.lastInsertRowid)));
});
app.patch("/api/units/:id", (req, res) => {
  const u = q.unit(num(req.params.id));
  if (!u) return res.status(404).end();
  const b = req.body ?? {};
  const ut = ["residential", "commercial", "garage"].includes(b.unit_type) ? b.unit_type : u.unit_type;
  db.prepare("UPDATE units SET label = ?, unit_type = ?, area_sqm = ?, persons = ?, heating_kwh = ?, water_m3 = ? WHERE id = ?")
    .run(String(b.label ?? u.label).slice(0, 60), ut, numOr(b.area_sqm, u.area_sqm), numOr(b.persons, u.persons), numOr(b.heating_kwh, u.heating_kwh), numOr(b.water_m3, u.water_m3), u.id);
  res.json(q.unit(u.id));
});
app.delete("/api/units/:id", (req, res) => { db.prepare("DELETE FROM units WHERE id = ?").run(num(req.params.id)); res.status(204).end(); });

app.post("/api/units/:id/tenants", (req, res) => {
  const u = q.unit(num(req.params.id));
  if (!u) return res.status(404).end();
  const b = req.body ?? {};
  if (!b.name || !b.email) return res.status(400).json({ error: "name and email required" });
  const r = db.prepare("INSERT INTO tenants (unit_id, name, email, monthly_prepayment_cents, move_in, move_out, portal_token, access_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(u.id, String(b.name).slice(0, 120), String(b.email).slice(0, 200), Math.round(numOr(b.monthly_prepayment_cents, 0)), isoOrNull(b.move_in), isoOrNull(b.move_out), randomBytes(16).toString("hex"), newAccessCode());
  res.status(201).json(q.tenant(Number(r.lastInsertRowid)));
});
app.patch("/api/tenants/:id", (req, res) => {
  const t = q.tenant(num(req.params.id));
  if (!t) return res.status(404).end();
  const b = req.body ?? {};
  db.prepare("UPDATE tenants SET name = ?, email = ?, monthly_prepayment_cents = ?, move_in = ?, move_out = ? WHERE id = ?")
    .run(String(b.name ?? t.name).slice(0, 120), String(b.email ?? t.email).slice(0, 200), Math.round(numOr(b.monthly_prepayment_cents, t.monthly_prepayment_cents)),
      "move_in" in b ? isoOrNull(b.move_in) : t.move_in, "move_out" in b ? isoOrNull(b.move_out) : t.move_out, t.id);
  res.json(q.tenant(t.id));
});
app.delete("/api/tenants/:id", (req, res) => { db.prepare("DELETE FROM tenants WHERE id = ?").run(num(req.params.id)); res.status(204).end(); });

// ---------- lease: upload → AI proposal (not saved) → landlord confirms ----------
async function leaseFromBuffer(buf: Buffer, originalName: string): Promise<{ extraction: LeaseExtraction; file_name: string }> {
  const safeName = `${Date.now()}-lease-${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  writeFileSync(path.join(UPLOAD_DIR, safeName), buf);
  const { text } = await pdfParse(buf);
  try {
    return { extraction: await extractLease({ text, fileName: originalName }), file_name: safeName };
  } catch (e) {
    const expectedPath = path.resolve("samples", "leases", "expected.json");
    const expected: Record<string, Partial<LeaseExtraction>> = existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, "utf8")) : {};
    const fb = expected[originalName];
    if (!fb) throw e;
    return { extraction: { ...coerceLease(fb), notes: `[sample extraction — AI unavailable] ${fb.notes ?? ""}` }, file_name: safeName };
  }
}
app.post("/api/tenants/:id/lease/extract", upload.single("file"), async (req, res) => {
  if (!q.tenant(num(req.params.id))) return res.status(404).end();
  if (!req.file) return res.status(400).json({ error: "file missing" });
  if (req.file.mimetype !== "application/pdf" && !req.file.originalname.toLowerCase().endsWith(".pdf")) return res.status(400).json({ error: "upload the lease as PDF" });
  try { res.json(await leaseFromBuffer(req.file.buffer, req.file.originalname)); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); }
});
// Demo helper: read the bundled sample lease for this tenant.
app.post("/api/tenants/:id/lease/sample", async (req, res) => {
  if (!q.tenant(num(req.params.id))) return res.status(404).end();
  const f = path.resolve("samples", "leases", "mietvertrag-oeztuerk.pdf");
  if (!existsSync(f)) return res.status(404).json({ error: "sample lease missing" });
  try { res.json(await leaseFromBuffer(readFileSync(f), "mietvertrag-oeztuerk.pdf")); }
  catch (e) { res.status(500).json({ error: (e as Error).message }); }
});
app.put("/api/tenants/:id/lease", (req, res) => {
  const t = q.tenant(num(req.params.id));
  if (!t) return res.status(404).end();
  const b = req.body ?? {};
  const cur = leaseOf(t);
  const c = coerceLease(b);
  const rules = { prepayment_type: c.prepayment_type, key_overrides: c.key_overrides, excluded_categories: c.excluded_categories, clauses: c.clauses,
    source_file: typeof b.source_file === "string" ? b.source_file.slice(0, 200) : cur.source_file, confirmed: b.confirmed === true };
  db.prepare("UPDATE tenants SET lease_json = ? WHERE id = ?").run(JSON.stringify(rules), t.id);
  res.json(rules);
});
app.get("/api/tenants/:id/lease/file", (req, res) => {
  const t = q.tenant(num(req.params.id));
  const f = t ? leaseOf(t).source_file : null;
  if (!f) return res.status(404).end();
  res.sendFile(path.join(UPLOAD_DIR, f));
});

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
  const nonAlloc = Math.min(amount, Math.max(0, Math.round(Number(b.non_allocable_cents ?? 0)) || 0));
  const r = db.prepare(
    `INSERT INTO invoices (property_id, provider, category, description, amount_cents, period_start, period_end, allocation_key, allocable, non_allocable_cents, non_allocable_reason, co2_cents, energy_kwh, source, file_name, ai_confidence, ai_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(propertyId, String(b.provider ?? "").slice(0, 120), category, String(b.description ?? "").slice(0, 200), amount,
    String(b.period_start), String(b.period_end), key, b.allocable === false ? 0 : 1, nonAlloc, b.non_allocable_reason ? String(b.non_allocable_reason).slice(0, 200) : null,
    Math.max(0, Math.round(Number(b.co2_cents ?? 0)) || 0), Math.max(0, Number(b.energy_kwh ?? 0) || 0),
    String(b.source ?? "manual"), b.file_name ? String(b.file_name) : null, b.ai_confidence == null ? null : Number(b.ai_confidence), b.ai_notes ? String(b.ai_notes) : null);
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
  const amount = Math.round(Number(b.amount_cents ?? inv.amount_cents));
  const nonAlloc = Math.min(amount, Math.max(0, Math.round(Number(b.non_allocable_cents ?? inv.non_allocable_cents)) || 0));
  db.prepare(`UPDATE invoices SET provider=?, category=?, description=?, amount_cents=?, period_start=?, period_end=?, allocation_key=?, allocable=?, non_allocable_cents=?, non_allocable_reason=?, co2_cents=?, energy_kwh=? WHERE id=?`)
    .run(String(b.provider ?? inv.provider).slice(0, 120), category, String(b.description ?? inv.description ?? "").slice(0, 200),
      amount, String(b.period_start ?? inv.period_start), String(b.period_end ?? inv.period_end),
      key, b.allocable === undefined ? inv.allocable : (b.allocable ? 1 : 0), nonAlloc,
      b.non_allocable_reason === undefined ? inv.non_allocable_reason : (b.non_allocable_reason ? String(b.non_allocable_reason).slice(0, 200) : null),
      b.co2_cents === undefined ? inv.co2_cents : Math.max(0, Math.round(Number(b.co2_cents)) || 0),
      b.energy_kwh === undefined ? inv.energy_kwh : Math.max(0, Number(b.energy_kwh) || 0), inv.id);
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
  // Safety net for the demo: if no AI key is configured (or the API fails), fall back to the stored
  // extraction for the known sample files. Marked as source "sample" so nobody mistakes it for a live AI read.
  const expectedPath = path.join(dir, "expected.json");
  const expected: Record<string, Extraction> = existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, "utf8")) : {};
  let usedFallback = false;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".pdf") && !already.has(f))) {
    try {
      const { extraction, file_name } = await extractFromBuffer(readFileSync(path.join(dir, f)), f, "application/pdf");
      imported.push(insertInvoice(propertyId, { ...extraction, source: "sync", file_name, ai_confidence: extraction.confidence, ai_notes: extraction.notes }));
    } catch (e) {
      const fb = expected[f];
      if (!fb) { errors.push(`${f}: ${(e as Error).message}`); continue; }
      usedFallback = true;
      const safeName = `${Date.now()}-${f}`;
      writeFileSync(path.join(UPLOAD_DIR, safeName), readFileSync(path.join(dir, f)));
      imported.push(insertInvoice(propertyId, { ...fb, source: "sample", file_name: safeName, ai_confidence: fb.confidence, ai_notes: fb.notes }));
    }
  }
  if (usedFallback) errors.push("AI extraction unavailable (no OPENROUTER_API_KEY or API error) — used stored sample extractions instead.");
  res.json({ imported, errors });
});

// ---------- document archive ----------
// One list for everything on file: free uploads, booked invoices with a PDF, scanned leases, generated statements.
app.get("/api/properties/:id/documents", (req, res) => {
  const pid = num(req.params.id);
  const tenants = q.tenants(pid);
  const unitOf = new Map(q.units(pid).map((u) => [u.id, u.label]));
  const rows: unknown[] = [];
  for (const d of q.documents(pid)) rows.push({ ...d, source: "upload", url: `/api/documents/${d.id}/file`, tenant_name: d.tenant_id ? tenants.find((t) => t.id === d.tenant_id)?.name ?? null : null });
  for (const inv of q.invoices(pid)) if (inv.file_name) rows.push({
    id: `inv-${inv.id}`, kind: "invoice", title: inv.description || `${inv.provider} ${inv.period_start.slice(0, 4)}`, provider: inv.provider, doc_date: inv.period_end,
    amount_cents: inv.amount_cents, tenant_id: null, tenant_name: null, invoice_id: inv.id, file_name: inv.file_name, mime: "application/pdf",
    size_bytes: fileSize(inv.file_name), notes: inv.category, created_at: inv.created_at, source: inv.source, url: `/api/invoices/${inv.id}/file`, booked: true,
  });
  for (const t of tenants) { const l = leaseOf(t); if (l.source_file) rows.push({
    id: `lease-${t.id}`, kind: "contract", title: `Mietvertrag ${t.name}`, provider: t.name, doc_date: t.move_in, amount_cents: null, tenant_id: t.id, tenant_name: t.name,
    invoice_id: null, file_name: l.source_file, mime: "application/pdf", size_bytes: fileSize(l.source_file), notes: unitOf.get(t.unit_id) ?? null, created_at: t.move_in ?? "", source: "lease", url: `/api/tenants/${t.id}/lease/file`, lease_confirmed: l.confirmed,
  }); }
  for (const t of tenants) for (const st of q.statementsForTenant(t.id)) rows.push({
    id: `stmt-${st.id}`, kind: "statement", title: `Betriebskostenabrechnung ${st.year} – ${t.name}`, provider: "Billnest", doc_date: st.created_at.slice(0, 10), amount_cents: st.balance_cents,
    tenant_id: t.id, tenant_name: t.name, invoice_id: null, file_name: null, mime: "application/pdf", size_bytes: null, notes: st.sent_at ? "sent" : "draft", created_at: st.created_at, source: "generated", url: `/api/statements/${st.id}/pdf`,
  });
  res.json(rows);
});
function fileSize(name: string): number | null { try { return statSync(path.join(UPLOAD_DIR, name)).size; } catch { return null; } }

// Upload → optional AI classification (proposal only) → stored with the landlord's metadata.
app.post("/api/properties/:id/documents", upload.single("file"), async (req, res) => {
  const pid = num(req.params.id);
  if (!q.property(pid)) return res.status(404).end();
  if (!req.file) return res.status(400).json({ error: "file missing" });
  const mime = req.file.mimetype;
  const isPdf = mime === "application/pdf" || req.file.originalname.toLowerCase().endsWith(".pdf");
  if (!isPdf && !mime.startsWith("image/")) return res.status(400).json({ error: "PDF or image only" });
  const safeName = `${Date.now()}-doc-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  writeFileSync(path.join(UPLOAD_DIR, safeName), req.file.buffer);
  // AI proposal; if unavailable, fall back to the file name so the upload never fails.
  let cls = { kind: "other" as DocKind, title: req.file.originalname.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 120), provider: "", doc_date: null as string | null, amount_cents: null as number | null, confidence: 0 };
  let text = "";
  try { if (isPdf) text = (await pdfParse(req.file.buffer)).text; } catch { /* scanned PDF without text layer */ }
  try {
    cls = isPdf ? await classifyDocument({ text, fileName: req.file.originalname }) : await classifyDocument({ imageBase64: req.file.buffer.toString("base64"), mime, fileName: req.file.originalname });
  } catch { if (text) cls = heuristicClassify(text, req.file.originalname); }
  const b = req.body ?? {};
  const kind = (DOC_KINDS as readonly string[]).includes(b.kind) ? (b.kind as DocKind) : cls.kind;
  const r = db.prepare("INSERT INTO documents (property_id, kind, title, provider, doc_date, amount_cents, tenant_id, file_name, mime, size_bytes, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(pid, kind, String(b.title || cls.title || req.file.originalname).slice(0, 120), String(b.provider || cls.provider || "").slice(0, 120) || null,
      isoOrNull(b.doc_date) ?? cls.doc_date, b.amount_cents != null && b.amount_cents !== "" ? Math.round(Number(b.amount_cents)) : cls.amount_cents,
      b.tenant_id ? num(b.tenant_id) : null, safeName, isPdf ? "application/pdf" : mime, req.file.size, b.notes ? String(b.notes).slice(0, 500) : null);
  res.status(201).json({ ...q.document(Number(r.lastInsertRowid)), ai_confidence: cls.confidence });
});
app.patch("/api/documents/:id", (req, res) => {
  const d = q.document(num(req.params.id));
  if (!d) return res.status(404).end();
  const b = req.body ?? {};
  db.prepare("UPDATE documents SET kind = ?, title = ?, provider = ?, doc_date = ?, amount_cents = ?, tenant_id = ?, notes = ? WHERE id = ?")
    .run((DOC_KINDS as readonly string[]).includes(b.kind) ? b.kind : d.kind, String(b.title ?? d.title).slice(0, 120), b.provider === undefined ? d.provider : (String(b.provider).slice(0, 120) || null),
      "doc_date" in b ? isoOrNull(b.doc_date) : d.doc_date, "amount_cents" in b ? (b.amount_cents === null || b.amount_cents === "" ? null : Math.round(Number(b.amount_cents))) : d.amount_cents,
      "tenant_id" in b ? (b.tenant_id ? num(b.tenant_id) : null) : d.tenant_id, "notes" in b ? (b.notes ? String(b.notes).slice(0, 500) : null) : d.notes, d.id);
  res.json(q.document(d.id));
});
app.delete("/api/documents/:id", (req, res) => {
  const d = q.document(num(req.params.id));
  if (d) { db.prepare("DELETE FROM documents WHERE id = ?").run(d.id); try { unlinkSync(path.join(UPLOAD_DIR, d.file_name)); } catch { /* already gone */ } }
  res.status(204).end();
});
app.get("/api/documents/:id/file", (req, res) => {
  const d = q.document(num(req.params.id));
  if (!d) return res.status(404).end();
  res.setHeader("Content-Type", d.mime);
  res.sendFile(path.join(UPLOAD_DIR, d.file_name));
});
// Book an archived invoice: run the invoice extraction on the stored file and hand it to the review form (not saved yet).
app.post("/api/documents/:id/extract-invoice", async (req, res) => {
  const d = q.document(num(req.params.id));
  if (!d) return res.status(404).end();
  try {
    const buf = readFileSync(path.join(UPLOAD_DIR, d.file_name));
    const r = await extractFromBuffer(buf, d.title + (d.mime === "application/pdf" ? ".pdf" : ""), d.mime);
    res.json({ ...r, document_id: d.id });
  } catch (e) { res.status(500).json({ error: (e as Error).message }); }
});
app.post("/api/documents/:id/link-invoice", (req, res) => {
  const d = q.document(num(req.params.id));
  if (!d) return res.status(404).end();
  db.prepare("UPDATE documents SET invoice_id = ? WHERE id = ?").run(num(req.body?.invoice_id), d.id);
  res.json(q.document(d.id));
});

// ---------- statements ----------
const withLines = (s: ReturnType<typeof q.statements>[number]) => ({ ...s, lines: JSON.parse(s.lines_json), lines_json: undefined });
const runPayload = (propertyId: number, year: number) => {
  const run = q.run(propertyId, year);
  return {
    statements: q.statements(propertyId, year).map(withLines),
    summary: run ? JSON.parse(run.summary_json) : null,
    checks: run ? JSON.parse(run.checks_json) : [],
    created_at: run?.created_at ?? null,
  };
};

app.post("/api/properties/:id/statements/generate", (req, res) => {
  const propertyId = num(req.params.id);
  const year = num(req.body?.year);
  if (!Number.isFinite(year)) return res.status(400).json({ error: "year missing" });
  const property = q.property(propertyId);
  if (!property) return res.status(404).end();
  const { statements, summary, checks } = computeStatements(q.units(propertyId), q.tenants(propertyId), q.invoices(propertyId, year), year, settingsOf(property));
  const up = db.prepare(
    `INSERT INTO statements (tenant_id, year, total_cents, prepaid_cents, balance_cents, suggested_prepayment_cents, lines_json) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, year) DO UPDATE SET total_cents=excluded.total_cents, prepaid_cents=excluded.prepaid_cents,
       balance_cents=excluded.balance_cents, suggested_prepayment_cents=excluded.suggested_prepayment_cents, lines_json=excluded.lines_json, created_at=datetime('now'), sent_at=NULL`
  );
  for (const s of statements) up.run(s.tenant.id, year, s.total_cents, s.prepaid_cents, s.balance_cents, s.suggested_prepayment_cents, JSON.stringify(s.lines));
  db.prepare(`INSERT INTO runs (property_id, year, summary_json, checks_json) VALUES (?, ?, ?, ?)
    ON CONFLICT(property_id, year) DO UPDATE SET summary_json=excluded.summary_json, checks_json=excluded.checks_json, created_at=datetime('now')`)
    .run(propertyId, year, JSON.stringify(summary), JSON.stringify(checks));
  res.json(runPayload(propertyId, year));
});
app.get("/api/properties/:id/statements", (req, res) => {
  res.json(runPayload(num(req.params.id), num(req.query.year)));
});

function buildTenantStatement(sid: number) {
  const s = q.statement(sid);
  if (!s) return null;
  const tenant = q.tenant(s.tenant_id)!, unit = q.unit(tenant.unit_id)!, property = q.property(unit.property_id)!;
  return { s, property, ts: { tenant, unit, year: s.year, lines: JSON.parse(s.lines_json), total_cents: s.total_cents, prepaid_cents: s.prepaid_cents, months_occupied: occupiedMonths(tenant, s.year), balance_cents: s.balance_cents, suggested_prepayment_cents: s.suggested_prepayment_cents } };
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
  // A statement with unresolved blockers must not go out.
  const run = q.run(b.property.id, b.s.year);
  const blockers = run ? (JSON.parse(run.checks_json) as { level: string; message: string }[]).filter((c) => c.level === "BLOCKER") : [];
  if (blockers.length) return res.status(409).json({ error: `Blocked: ${blockers.map((c) => c.message).join(" ")}` });
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
<p>Jede Position können Sie mit Originalbeleg im Mieterportal nachvollziehen:<br><a href="${portalUrl}">${portalUrl}</a><br>
Oder melden Sie sich unter <a href="${APP_URL()}/login">${APP_URL()}/login</a> an — E-Mail: ${b.ts.tenant.email}, Zugangscode: <strong>${b.ts.tenant.access_code}</strong></p>
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

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3000);
app.listen(port, () => console.log(`api listening on :${port}`));
