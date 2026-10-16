import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import path from "node:path";
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { CATEGORIES, DEFAULT_KEY, HEATING_TYPES, DOC_KINDS, settingsOf, leaseOf, parseJson, type Category, type AllocationKey, type HeatingType, type DocKind, type Document, type Invoice, type Payment, type Property, type Statement, type Tenant, type Unit } from "./db.js";
import { loadDemo } from "./seed.js";
import { computeStatements, occupiedMonths, RULES_VERSION, type StatementLine } from "./allocation.js";
import { extractInvoices, extractLease, coerceLease, classifyDocument, heuristicClassify, type Extraction, type LeaseExtraction } from "./ai.js";
import { bearer, cookieFlags, makeSession, requireUser, tenantTokenFromSession } from "./auth.js";
import { anon, supabaseConfig } from "./supa.js";
import { DbError, type Store } from "./store.js";
import { sendMail } from "./mail.js";
import { statementPdf, eur } from "./pdf.js";

// pdf-parse is CommonJS; createRequire keeps it working under ESM.
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string; numpages: number }>;

const app = express();
app.set("trust proxy", 1); // behind Traefik: req.ip is the client, not the proxy (rate limits)
app.use(express.json({ limit: "1mb" }));

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.resolve("uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const APP_URL = () => (process.env.APP_URL ?? "http://localhost:5173").replace(/\/$/, "");
const num = (v: unknown) => Number.parseInt(String(v), 10);
const isoOrNull = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const numOr = (v: unknown, d: number) => (v === undefined || v === null || v === "" ? d : Number(v));

// Files stay on the server's volume, one folder per organization. They are only served after the
// database (under RLS) has confirmed the row the file belongs to — the path alone grants nothing.
function saveFile(orgId: string, originalName: string, buf: Buffer, prefix = "") {
  mkdirSync(path.join(UPLOAD_DIR, orgId), { recursive: true });
  const rel = `${orgId}/${Date.now()}-${prefix}${originalName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  writeFileSync(path.join(UPLOAD_DIR, rel), buf);
  return rel;
}
const filePath = (rel: string) => {
  const p = path.resolve(UPLOAD_DIR, rel);
  if (!p.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) throw new DbError("bad path", 400);
  return p;
};
function fileSize(rel: string): number | null { try { return statSync(filePath(rel)).size; } catch { return null; } }

const loginHits = new Map<string, number[]>();
function rateLimited(req: Request, max = 20, windowMs = 15 * 60_000): boolean {
  const key = `${req.path}|${req.ip ?? "?"}`, now = Date.now();
  const hits = (loginHits.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now); loginHits.set(key, hits);
  return hits.length > max;
}

// ───────────────────────── public ─────────────────────────

// The browser needs the project URL and the public (anon) key to sign in. Both are public by design.
app.get("/api/public-config", (_req, res) => {
  const { url, anonKey } = supabaseConfig();
  res.json({ supabase_url: url, supabase_anon_key: anonKey });
});

// Mirror the Supabase access token into an HttpOnly cookie so that plain links (PDF, invoice files)
// work. Only accepted for GET requests — writes always need the Authorization header.
app.post("/api/session", async (req, res) => {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "unauthorized" });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: "unauthorized" });
  res.setHeader("Set-Cookie", `sb_token=${token}; ${cookieFlags()}; Max-Age=3600`);
  res.json({ ok: true });
});
app.delete("/api/session", (_req, res) => {
  res.setHeader("Set-Cookie", `sb_token=; ${cookieFlags()}; Max-Age=0`);
  res.json({ ok: true });
});

// Tenants: register once with e-mail + code (from the statement) + password; afterwards e-mail + password.
// The checks run inside Postgres (bcrypt, narrow SECURITY DEFINER functions); the server only rate-limits
// and turns the returned portal token into a signed session cookie.
function setTenantCookie(res: Response, portalToken: string) {
  res.setHeader("Set-Cookie", `tenant=${makeSession("tenant", portalToken)}; ${cookieFlags()}; Max-Age=43200`);
}
app.post("/api/tenant-register", async (req, res) => {
  if (rateLimited(req)) return res.status(429).json({ error: "too many attempts — try again in 15 minutes" });
  const password = String(req.body?.password ?? "");
  if (password.length < 8) return res.status(400).json({ error: "password too short (min. 8 characters)" });
  const { data, error } = await anon.rpc("tenant_register", { p_email: String(req.body?.email ?? ""), p_code: String(req.body?.code ?? ""), p_password: password });
  if (error) return res.status(error.message.includes("already registered") ? 409 : 400).json({ error: error.message.includes("already registered") ? "already registered — sign in with your password, or ask your landlord for a new code" : "registration failed" });
  if (!data) return res.status(401).json({ error: "wrong e-mail or access code" });
  setTenantCookie(res, data as string);
  res.json({ ok: true });
});
app.post("/api/tenant-login", async (req, res) => {
  if (rateLimited(req)) return res.status(429).json({ error: "too many attempts — try again in 15 minutes" });
  const { data, error } = await anon.rpc("tenant_login", { p_email: String(req.body?.email ?? ""), p_password: String(req.body?.password ?? "") });
  if (error || !data) return res.status(401).json({ error: "wrong e-mail or password" });
  setTenantCookie(res, data as string);
  res.json({ ok: true });
});
app.post("/api/tenant-logout", (_req, res) => {
  res.setHeader("Set-Cookie", `tenant=; ${cookieFlags()}; Max-Age=0`);
  res.json({ ok: true });
});

// Tenant portal: "me" = signed-in tenant (cookie carries the portal token), ":token" = link from the statement mail.
async function portalData(token: string) {
  const { data, error } = await anon.rpc("portal_by_token", { p_token: token });
  if (error) throw new DbError(error.message);
  return data as Record<string, unknown> | null;
}
async function portalFile(token: string, invoiceId: number, res: Response) {
  const { data } = await anon.rpc("portal_invoice_file", { p_token: token, p_invoice_id: invoiceId });
  if (!data) return res.status(404).end();
  res.sendFile(filePath(data as string));
}
app.get("/api/portal/me", async (req, res) => {
  const token = tenantTokenFromSession(req);
  const d = token ? await portalData(token) : null;
  if (!d) return res.status(401).json({ error: "unauthorized" });
  res.json(d);
});
app.get("/api/portal/me/invoice/:id/file", async (req, res) => {
  const token = tenantTokenFromSession(req);
  if (!token) return res.status(401).end();
  await portalFile(token, num(req.params.id), res);
});
app.get("/api/portal/:token", async (req, res) => {
  if (rateLimited(req, 120, 60_000)) return res.status(429).end();
  const d = await portalData(req.params.token);
  if (!d) return res.status(404).json({ error: "not found" });
  res.json(d);
});
app.get("/api/portal/:token/invoice/:id/file", async (req, res) => {
  if (rateLimited(req, 120, 60_000)) return res.status(429).end();
  await portalFile(req.params.token, num(req.params.id), res);
});

app.post("/api/waitlist", async (req, res) => {
  if (rateLimited(req, 10, 3_600_000)) return res.status(429).json({ error: "too many requests" });
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return res.status(400).json({ error: "Please enter a valid e-mail address." });
  const units = Number.isFinite(Number(req.body?.units)) ? Math.max(0, Math.min(10000, Math.round(Number(req.body.units)))) : null;
  const { error } = await anon.rpc("join_waitlist", { p_email: email, p_units: units });
  if (error) return res.status(500).json({ error: "could not save" });
  res.status(201).json({ ok: true });
});

// ───────────────────────── everything below: signed-in landlord, own organization only ─────────────────────────
app.use("/api", requireUser);
const st = (req: Request): Store => req.ctx.st;

app.get("/api/me", async (req, res) => {
  const org = await st(req).organization();
  res.json({ email: req.ctx.user.email, org });
});
app.patch("/api/organization", async (req, res) => {
  const b = req.body ?? {};
  const patch: Record<string, unknown> = {};
  for (const k of ["name", "landlord_name", "landlord_address", "iban", "contact_email"]) if (k in b) patch[k] = b[k] == null ? null : String(b[k]).slice(0, 300);
  res.json(await st(req).updateOrganization(patch));
});
app.get("/api/meta", (_req, res) => res.json({ categories: CATEGORIES, default_key: DEFAULT_KEY, heating_types: HEATING_TYPES, rules: RULES_VERSION }));

// Sample buildings for a fresh account (only when it has none yet).
app.post("/api/demo", async (req, res) => {
  if ((await st(req).properties()).length > 0) return res.status(409).json({ error: "your account already has buildings" });
  await loadDemo(st(req));
  res.json({ ok: true });
});

// ---------- tenants overview ----------
app.get("/api/tenants", async (req, res) => {
  const all = await st(req).allTenants();
  const latest = new Map<number, Statement>();
  if (all.length) {
    const { data } = await req.ctx.sb.from("statements").select("*").in("tenant_id", all.map((t) => t.id)).order("year", { ascending: false });
    for (const s of (data ?? []) as Statement[]) if (!latest.has(s.tenant_id)) latest.set(s.tenant_id, s);
  }
  res.json(all.map((t) => {
    const s = latest.get(t.id), l = leaseOf(t);
    return { ...t, lease: l, lease_json: undefined, registered: !!t.registered_at,
      lease_rules: Object.keys(l.key_overrides).length > 0 || l.excluded_categories.length > 0 || l.prepayment_type === "pauschale",
      latest: s ? { id: s.id, year: s.year, balance_cents: s.balance_cents, sent_at: s.sent_at, payment_status: s.payment_status, paid_at: s.paid_at } : null };
  }));
});

// ---------- properties ----------
const shapeTenant = (t: Tenant) => ({ ...t, lease: leaseOf(t), lease_json: undefined, registered: !!t.registered_at });
app.get("/api/properties", async (req, res) => {
  const props = await st(req).properties();
  res.json(await Promise.all(props.map(async (p) => ({
    ...p, settings: settingsOf(p), settings_json: undefined,
    units: await st(req).units(p.id), tenants: (await st(req).tenants(p.id)).map(shapeTenant),
  }))));
});
app.post("/api/properties", async (req, res) => {
  const b = req.body ?? {};
  if (!b.name) return res.status(400).json({ error: "name missing" });
  res.status(201).json(await st(req).insert<Property>("properties", { name: String(b.name).slice(0, 120), address: String(b.address ?? "").slice(0, 200) }));
});
app.delete("/api/properties/:id", async (req, res) => {
  await st(req).remove("properties", num(req.params.id));
  res.status(204).end();
});
app.patch("/api/properties/:id", async (req, res) => {
  const p = await st(req).property(num(req.params.id));
  if (!p) return res.status(404).end();
  const b = req.body ?? {};
  res.json(await st(req).update("properties", p.id, { name: String(b.name ?? p.name).slice(0, 120), address: String(b.address ?? p.address).slice(0, 200) }));
});
app.patch("/api/properties/:id/settings", async (req, res) => {
  const p = await st(req).property(num(req.params.id));
  if (!p) return res.status(404).end();
  const cur = settingsOf(p), b = req.body ?? {};
  const next = {
    heating_type: (HEATING_TYPES as readonly string[]).includes(b.heating_type) ? (b.heating_type as HeatingType) : cur.heating_type,
    consumption_share: Number.isFinite(Number(b.consumption_share)) ? Math.min(0.7, Math.max(0.5, Number(b.consumption_share))) : cur.consumption_share,
    hot_water_central: typeof b.hot_water_central === "boolean" ? b.hot_water_central : cur.hot_water_central,
    heizkv_exempt: typeof b.heizkv_exempt === "boolean" ? b.heizkv_exempt : cur.heizkv_exempt,
    heated_area_sqm: b.heated_area_sqm === null || b.heated_area_sqm === "" ? null : Number.isFinite(Number(b.heated_area_sqm)) ? Number(b.heated_area_sqm) : cur.heated_area_sqm,
  };
  await st(req).update("properties", p.id, { settings_json: next });
  res.json(next);
});

// ---------- units & tenants ----------
app.post("/api/properties/:id/units", async (req, res) => {
  const b = req.body ?? {};
  if (!b.label) return res.status(400).json({ error: "label missing" });
  const ut = ["residential", "commercial", "garage"].includes(b.unit_type) ? b.unit_type : "residential";
  res.status(201).json(await st(req).insert<Unit>("units", {
    property_id: num(req.params.id), label: String(b.label).slice(0, 60), unit_type: ut,
    area_sqm: numOr(b.area_sqm, 0), mea: numOr(b.mea, 0), persons: numOr(b.persons, 1), heating_kwh: numOr(b.heating_kwh, 0), water_m3: numOr(b.water_m3, 0),
  }));
});
app.patch("/api/units/:id", async (req, res) => {
  const u = await st(req).unit(num(req.params.id));
  if (!u) return res.status(404).end();
  const b = req.body ?? {};
  res.json(await st(req).update("units", u.id, {
    label: String(b.label ?? u.label).slice(0, 60), unit_type: ["residential", "commercial", "garage"].includes(b.unit_type) ? b.unit_type : u.unit_type,
    area_sqm: numOr(b.area_sqm, u.area_sqm), mea: numOr(b.mea, u.mea), persons: numOr(b.persons, u.persons),
    heating_kwh: numOr(b.heating_kwh, u.heating_kwh), water_m3: numOr(b.water_m3, u.water_m3),
  }));
});
app.delete("/api/units/:id", async (req, res) => { await st(req).remove("units", num(req.params.id)); res.status(204).end(); });

app.post("/api/units/:id/tenants", async (req, res) => {
  const u = await st(req).unit(num(req.params.id));
  if (!u) return res.status(404).end();
  const b = req.body ?? {};
  if (!b.name || !b.email) return res.status(400).json({ error: "name and email required" });
  const t = await st(req).insert<Tenant>("tenants", {
    unit_id: u.id, name: String(b.name).slice(0, 120), email: String(b.email).slice(0, 200),
    monthly_prepayment_cents: Math.round(numOr(b.monthly_prepayment_cents, 0)), move_in: isoOrNull(b.move_in), move_out: isoOrNull(b.move_out),
  });
  res.status(201).json(shapeTenant(t));
});
app.patch("/api/tenants/:id", async (req, res) => {
  const t = await st(req).tenant(num(req.params.id));
  if (!t) return res.status(404).end();
  const b = req.body ?? {};
  const r = await st(req).update<Tenant>("tenants", t.id, {
    name: String(b.name ?? t.name).slice(0, 120), email: String(b.email ?? t.email).slice(0, 200),
    monthly_prepayment_cents: Math.round(numOr(b.monthly_prepayment_cents, t.monthly_prepayment_cents)),
    move_in: "move_in" in b ? isoOrNull(b.move_in) : t.move_in, move_out: "move_out" in b ? isoOrNull(b.move_out) : t.move_out,
  });
  res.json(r && shapeTenant(r));
});
app.delete("/api/tenants/:id", async (req, res) => { await st(req).remove("tenants", num(req.params.id)); res.status(204).end(); });
// New registration code = the tenant registers again (password forgotten). Old password stops working.
app.post("/api/tenants/:id/reset-access", async (req, res) => {
  await st(req).resetTenantAccess(num(req.params.id));
  const t = await st(req).tenant(num(req.params.id));
  res.json(t && shapeTenant(t));
});

// ---------- lease: upload → AI proposal (not saved) → landlord confirms ----------
async function leaseFromBuffer(orgId: string, buf: Buffer, originalName: string): Promise<{ extraction: LeaseExtraction; file_name: string }> {
  const file_name = saveFile(orgId, originalName, buf, "lease-");
  const { text } = await pdfParse(buf);
  try {
    return { extraction: await extractLease({ text, fileName: originalName }), file_name };
  } catch (e) {
    const expectedPath = path.resolve("samples", "leases", "expected.json");
    const expected: Record<string, Partial<LeaseExtraction>> = existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, "utf8")) : {};
    const fb = expected[originalName];
    if (!fb) throw e;
    return { extraction: { ...coerceLease(fb), notes: `[sample extraction — AI unavailable] ${fb.notes ?? ""}` }, file_name };
  }
}
app.post("/api/tenants/:id/lease/extract", upload.single("file"), async (req, res) => {
  if (!(await st(req).tenant(num(req.params.id)))) return res.status(404).end();
  if (!req.file) return res.status(400).json({ error: "file missing" });
  if (req.file.mimetype !== "application/pdf" && !req.file.originalname.toLowerCase().endsWith(".pdf")) return res.status(400).json({ error: "upload the lease as PDF" });
  res.json(await leaseFromBuffer(req.ctx.orgId, req.file.buffer, req.file.originalname));
});
app.post("/api/tenants/:id/lease/sample", async (req, res) => {
  if (!(await st(req).tenant(num(req.params.id)))) return res.status(404).end();
  const f = path.resolve("samples", "leases", "mietvertrag-oeztuerk.pdf");
  if (!existsSync(f)) return res.status(404).json({ error: "sample lease missing" });
  res.json(await leaseFromBuffer(req.ctx.orgId, readFileSync(f), "mietvertrag-oeztuerk.pdf"));
});
app.put("/api/tenants/:id/lease", async (req, res) => {
  const t = await st(req).tenant(num(req.params.id));
  if (!t) return res.status(404).end();
  const b = req.body ?? {};
  const cur = leaseOf(t), c = coerceLease(b);
  // source_file must stay inside this organization's folder
  const src = typeof b.source_file === "string" && b.source_file.startsWith(`${req.ctx.orgId}/`) ? b.source_file.slice(0, 200) : cur.source_file;
  const rules = { prepayment_type: c.prepayment_type, key_overrides: c.key_overrides, excluded_categories: c.excluded_categories, clauses: c.clauses, source_file: src, confirmed: b.confirmed === true };
  await st(req).update("tenants", t.id, { lease_json: rules });
  res.json(rules);
});
app.get("/api/tenants/:id/lease/file", async (req, res) => {
  const t = await st(req).tenant(num(req.params.id));
  const f = t ? leaseOf(t).source_file : null;
  if (!f) return res.status(404).end();
  res.sendFile(filePath(f));
});

// ---------- payments received ----------
app.get("/api/tenants/:id/payments", async (req, res) => res.json(await st(req).payments(num(req.params.id))));
app.post("/api/tenants/:id/payments", async (req, res) => {
  const t = await st(req).tenant(num(req.params.id));
  if (!t) return res.status(404).end();
  const b = req.body ?? {};
  const on = isoOrNull(b.paid_on), cents = Math.round(Number(b.amount_cents));
  if (!on || !Number.isFinite(cents)) return res.status(400).json({ error: "date and amount required" });
  res.status(201).json(await st(req).insert<Payment>("payments", { tenant_id: t.id, paid_on: on, amount_cents: cents, note: b.note ? String(b.note).slice(0, 200) : null }));
});
// Book the contractual monthly amount for every month of the year the tenant lived there.
app.post("/api/tenants/:id/payments/fill-year", async (req, res) => {
  const t = await st(req).tenant(num(req.params.id));
  if (!t) return res.status(404).end();
  const year = num(req.body?.year);
  const existing = (await st(req).payments(t.id)).filter((p) => p.paid_on.startsWith(String(year)));
  if (existing.length) return res.status(409).json({ error: "payments for this year already exist" });
  const rows: Record<string, unknown>[] = [];
  for (let m = 1; m <= 12; m++) {
    const d = `${year}-${String(m).padStart(2, "0")}-01`;
    if (t.move_in && d < t.move_in.slice(0, 8) + "01") continue;
    if (t.move_out && d > t.move_out) continue;
    rows.push({ tenant_id: t.id, paid_on: d, amount_cents: t.monthly_prepayment_cents, note: "Vorauszahlung" });
  }
  await st(req).insertMany("payments", rows);
  res.json({ inserted: rows.length, payments: await st(req).payments(t.id) });
});
app.delete("/api/payments/:id", async (req, res) => { await st(req).remove("payments", num(req.params.id)); res.status(204).end(); });

// ---------- invoices ----------
app.get("/api/properties/:id/invoices", async (req, res) => {
  res.json(await st(req).invoices(num(req.params.id), req.query.year ? num(req.query.year) : undefined));
});

function invoiceRow(propertyId: number, b: Record<string, unknown>) {
  const category = (CATEGORIES as readonly string[]).includes(String(b.category)) ? (b.category as Category) : "other";
  const keys: AllocationKey[] = ["area", "mea", "persons", "units", "heating", "water"];
  const key = keys.includes(b.allocation_key as AllocationKey) ? (b.allocation_key as AllocationKey) : DEFAULT_KEY[category];
  const pool = ["all", "residential", "commercial"].includes(b.pool as string) ? (b.pool as string) : "all";
  const amount = Math.round(Number(b.amount_cents));
  if (!Number.isFinite(amount)) throw new DbError("amount_cents invalid", 400); // negative = credit note
  for (const d of [b.period_start, b.period_end]) if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) throw new DbError("period invalid", 400);
  return {
    property_id: propertyId, unit_id: b.unit_id ? num(b.unit_id) : null,
    provider: String(b.provider ?? "").slice(0, 120), category, description: String(b.description ?? "").slice(0, 200), amount_cents: amount,
    period_start: String(b.period_start), period_end: String(b.period_end), allocation_key: key, pool,
    allocable: b.allocable === false ? 0 : 1,
    non_allocable_cents: Math.min(Math.abs(amount), Math.max(0, Math.round(Number(b.non_allocable_cents ?? 0)) || 0)),
    non_allocable_reason: b.non_allocable_reason ? String(b.non_allocable_reason).slice(0, 200) : null,
    co2_cents: Math.max(0, Math.round(Number(b.co2_cents ?? 0)) || 0), energy_kwh: Math.max(0, Number(b.energy_kwh ?? 0) || 0),
    source: String(b.source ?? "manual").slice(0, 20), file_name: b.file_name ? String(b.file_name) : null,
    ai_confidence: b.ai_confidence == null ? null : Number(b.ai_confidence), ai_notes: b.ai_notes ? String(b.ai_notes).slice(0, 500) : null,
  };
}
async function insertInvoice(req: Request, propertyId: number, b: Record<string, unknown>) {
  const row = invoiceRow(propertyId, b);
  // a client-supplied file name must point into this organization's folder
  if (row.file_name && !row.file_name.startsWith(`${req.ctx.orgId}/`)) row.file_name = null;
  if (row.unit_id && (await st(req).unit(row.unit_id))?.property_id !== propertyId) throw new DbError("unit does not belong to this building", 400);
  return st(req).insert<Invoice>("invoices", row);
}
app.post("/api/properties/:id/invoices", async (req, res) => {
  res.status(201).json(await insertInvoice(req, num(req.params.id), req.body ?? {}));
});
app.patch("/api/invoices/:id", async (req, res) => {
  const inv = await st(req).invoice(num(req.params.id));
  if (!inv) return res.status(404).end();
  const b = req.body ?? {};
  const merged = invoiceRow(inv.property_id, {
    ...inv, ...b,
    allocable: b.allocable === undefined ? !!inv.allocable : !!b.allocable,
    unit_id: "unit_id" in b ? b.unit_id : inv.unit_id,
  });
  if (merged.unit_id && (await st(req).unit(merged.unit_id))?.property_id !== inv.property_id) return res.status(400).json({ error: "unit does not belong to this building" });
  const { property_id: _p, source: _s, file_name: _f, ai_confidence: _c, ai_notes: _n, ...patch } = merged;
  res.json(await st(req).update("invoices", inv.id, patch));
});
app.delete("/api/invoices/:id", async (req, res) => { await st(req).remove("invoices", num(req.params.id)); res.status(204).end(); });
app.get("/api/invoices/:id/file", async (req, res) => {
  const inv = await st(req).invoice(num(req.params.id));
  if (!inv?.file_name) return res.status(404).end();
  res.sendFile(filePath(inv.file_name));
});

/** Text layer usable? Scans often have none, or OCR garbage. Below ~40 chars per page we hand the PDF itself to the model. */
async function extractAllFromBuffer(orgId: string, buf: Buffer, originalName: string, mime: string): Promise<{ positions: Extraction[]; notes: string; file_name: string }> {
  const file_name = saveFile(orgId, originalName, buf);
  let result;
  if (mime === "application/pdf" || originalName.toLowerCase().endsWith(".pdf")) {
    let text = "", pages = 1;
    try { const r = await pdfParse(buf); text = r.text; pages = r.numpages || 1; } catch { /* no text layer */ }
    const usable = text.replace(/\s+/g, " ").trim().length >= 40 * pages;
    result = usable ? await extractInvoices({ text, fileName: originalName }) : await extractInvoices({ pdfBase64: buf.toString("base64"), fileName: originalName });
  } else if (mime.startsWith("image/")) {
    result = await extractInvoices({ imageBase64: buf.toString("base64"), mime, fileName: originalName });
  } else {
    throw new DbError("unsupported file type — upload a PDF or image", 400);
  }
  return { ...result, file_name };
}

app.post("/api/properties/:id/invoices/extract", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file missing" });
  if (!(await st(req).property(num(req.params.id)))) return res.status(404).end();
  const r = await extractAllFromBuffer(req.ctx.orgId, req.file.buffer, req.file.originalname, req.file.mimetype);
  if (!r.positions.length) return res.status(422).json({ error: "no cost position found in the document" });
  res.json({ positions: r.positions, notes: r.notes, file_name: r.file_name, extraction: r.positions[0] });
});

// "Inbox sync" for the demo: reads samples/ and books everything into this building.
app.post("/api/properties/:id/invoices/sync", async (req, res) => {
  const propertyId = num(req.params.id);
  if (!(await st(req).property(propertyId))) return res.status(404).end();
  const dir = path.resolve("samples");
  if (!existsSync(dir)) return res.json({ imported: [], errors: [] });
  const already = new Set((await st(req).invoices(propertyId)).map((i) => i.file_name?.split("/").pop()?.replace(/^\d+-/, "")));
  const imported: Invoice[] = [];
  const errors: string[] = [];
  const expectedPath = path.join(dir, "expected.json");
  const expected: Record<string, Extraction | Extraction[]> = existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, "utf8")) : {};
  let usedFallback = false;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".pdf") && !already.has(f))) {
    try {
      const r = await extractAllFromBuffer(req.ctx.orgId, readFileSync(path.join(dir, f)), f, "application/pdf");
      for (const p of r.positions) imported.push(await insertInvoice(req, propertyId, { ...p, source: "sync", file_name: r.file_name, ai_confidence: p.confidence, ai_notes: [p.notes, p.meter_note].filter(Boolean).join(" ") }));
    } catch (e) {
      const fb = expected[f];
      if (!fb) { errors.push(`${f}: ${(e as Error).message}`); continue; }
      usedFallback = true;
      const file_name = saveFile(req.ctx.orgId, f, readFileSync(path.join(dir, f)));
      for (const p of Array.isArray(fb) ? fb : [fb]) imported.push(await insertInvoice(req, propertyId, { ...p, source: "sample", file_name, ai_confidence: p.confidence, ai_notes: p.notes }));
    }
  }
  if (usedFallback) errors.push("AI extraction unavailable (no OPENROUTER_API_KEY or API error) — used stored sample extractions instead.");
  res.json({ imported, errors });
});

// ---------- document archive ----------
app.get("/api/properties/:id/documents", async (req, res) => {
  const pid = num(req.params.id);
  const [tenants, units, docs, invoices] = await Promise.all([st(req).tenants(pid), st(req).units(pid), st(req).documents(pid), st(req).invoices(pid)]);
  const unitOf = new Map(units.map((u) => [u.id, u.label]));
  const rows: unknown[] = [];
  for (const d of docs) rows.push({ ...d, source: "upload", url: `/api/documents/${d.id}/file`, tenant_name: d.tenant_id ? tenants.find((t) => t.id === d.tenant_id)?.name ?? null : null });
  for (const inv of invoices) if (inv.file_name) rows.push({
    id: `inv-${inv.id}`, kind: "invoice", title: inv.description || `${inv.provider} ${inv.period_start.slice(0, 4)}`, provider: inv.provider, doc_date: inv.period_end,
    amount_cents: inv.amount_cents, tenant_id: null, tenant_name: null, invoice_id: inv.id, file_name: inv.file_name, mime: "application/pdf",
    size_bytes: fileSize(inv.file_name), notes: inv.category, created_at: inv.created_at, source: inv.source, url: `/api/invoices/${inv.id}/file`, booked: true,
  });
  for (const t of tenants) { const l = leaseOf(t); if (l.source_file) rows.push({
    id: `lease-${t.id}`, kind: "contract", title: `Mietvertrag ${t.name}`, provider: t.name, doc_date: t.move_in, amount_cents: null, tenant_id: t.id, tenant_name: t.name,
    invoice_id: null, file_name: l.source_file, mime: "application/pdf", size_bytes: fileSize(l.source_file), notes: unitOf.get(t.unit_id) ?? null, created_at: t.move_in ?? "", source: "lease", url: `/api/tenants/${t.id}/lease/file`, lease_confirmed: l.confirmed,
  }); }
  if (tenants.length) {
    const { data } = await req.ctx.sb.from("statements").select("*").in("tenant_id", tenants.map((t) => t.id));
    for (const s of (data ?? []) as Statement[]) {
      const t = tenants.find((x) => x.id === s.tenant_id)!;
      rows.push({
        id: `stmt-${s.id}`, kind: "statement", title: `Betriebskostenabrechnung ${s.year} – ${t.name}`, provider: "Billnest", doc_date: s.created_at.slice(0, 10), amount_cents: s.balance_cents,
        tenant_id: t.id, tenant_name: t.name, invoice_id: null, file_name: null, mime: "application/pdf", size_bytes: null, notes: s.sent_at ? "sent" : "draft", created_at: s.created_at, source: "generated", url: `/api/statements/${s.id}/pdf`,
      });
    }
  }
  res.json(rows);
});

app.post("/api/properties/:id/documents", upload.single("file"), async (req, res) => {
  const pid = num(req.params.id);
  if (!(await st(req).property(pid))) return res.status(404).end();
  if (!req.file) return res.status(400).json({ error: "file missing" });
  const mime = req.file.mimetype;
  const isPdf = mime === "application/pdf" || req.file.originalname.toLowerCase().endsWith(".pdf");
  if (!isPdf && !mime.startsWith("image/")) return res.status(400).json({ error: "PDF or image only" });
  const file_name = saveFile(req.ctx.orgId, req.file.originalname, req.file.buffer, "doc-");
  // AI proposal; if unavailable, fall back to keywords / the file name so the upload never fails.
  let cls = { kind: "other" as DocKind, title: req.file.originalname.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 120), provider: "", doc_date: null as string | null, amount_cents: null as number | null, confidence: 0 };
  let text = "";
  try { if (isPdf) text = (await pdfParse(req.file.buffer)).text; } catch { /* scanned PDF without text layer */ }
  try {
    cls = isPdf ? await classifyDocument({ text, fileName: req.file.originalname }) : await classifyDocument({ imageBase64: req.file.buffer.toString("base64"), mime, fileName: req.file.originalname });
  } catch { if (text) cls = heuristicClassify(text, req.file.originalname); }
  const b = req.body ?? {};
  const d = await st(req).insert<Document>("documents", {
    property_id: pid, kind: (DOC_KINDS as readonly string[]).includes(b.kind) ? b.kind : cls.kind,
    title: String(b.title || cls.title || req.file.originalname).slice(0, 120), provider: String(b.provider || cls.provider || "").slice(0, 120) || null,
    doc_date: isoOrNull(b.doc_date) ?? cls.doc_date, amount_cents: b.amount_cents != null && b.amount_cents !== "" ? Math.round(Number(b.amount_cents)) : cls.amount_cents,
    tenant_id: b.tenant_id ? num(b.tenant_id) : null, file_name, mime: isPdf ? "application/pdf" : mime, size_bytes: req.file.size, notes: b.notes ? String(b.notes).slice(0, 500) : null,
  });
  res.status(201).json({ ...d, ai_confidence: cls.confidence });
});
app.patch("/api/documents/:id", async (req, res) => {
  const d = await st(req).document(num(req.params.id));
  if (!d) return res.status(404).end();
  const b = req.body ?? {};
  res.json(await st(req).update("documents", d.id, {
    kind: (DOC_KINDS as readonly string[]).includes(b.kind) ? b.kind : d.kind, title: String(b.title ?? d.title).slice(0, 120),
    provider: b.provider === undefined ? d.provider : (String(b.provider).slice(0, 120) || null),
    doc_date: "doc_date" in b ? isoOrNull(b.doc_date) : d.doc_date,
    amount_cents: "amount_cents" in b ? (b.amount_cents === null || b.amount_cents === "" ? null : Math.round(Number(b.amount_cents))) : d.amount_cents,
    tenant_id: "tenant_id" in b ? (b.tenant_id ? num(b.tenant_id) : null) : d.tenant_id,
    notes: "notes" in b ? (b.notes ? String(b.notes).slice(0, 500) : null) : d.notes,
  }));
});
app.delete("/api/documents/:id", async (req, res) => {
  const d = await st(req).document(num(req.params.id));
  if (d) { await st(req).remove("documents", d.id); try { unlinkSync(filePath(d.file_name)); } catch { /* already gone */ } }
  res.status(204).end();
});
app.get("/api/documents/:id/file", async (req, res) => {
  const d = await st(req).document(num(req.params.id));
  if (!d) return res.status(404).end();
  res.setHeader("Content-Type", d.mime);
  res.sendFile(filePath(d.file_name));
});
app.post("/api/documents/:id/extract-invoice", async (req, res) => {
  const d = await st(req).document(num(req.params.id));
  if (!d) return res.status(404).end();
  const r = await extractAllFromBuffer(req.ctx.orgId, readFileSync(filePath(d.file_name)), d.title + (d.mime === "application/pdf" ? ".pdf" : ""), d.mime);
  if (!r.positions.length) return res.status(422).json({ error: "no cost position found in the document" });
  res.json({ extraction: { ...r.positions[0], notes: [r.positions[0].notes, r.notes].filter(Boolean).join(" ") }, file_name: r.file_name, document_id: d.id });
});
app.post("/api/documents/:id/link-invoice", async (req, res) => {
  const d = await st(req).document(num(req.params.id));
  if (!d) return res.status(404).end();
  res.json(await st(req).update("documents", d.id, { invoice_id: num(req.body?.invoice_id) }));
});

// ---------- statements ----------
async function compute(req: Request, propertyId: number, year: number) {
  const s = st(req);
  const property = await s.property(propertyId);
  if (!property) return null;
  const [units, tenants, invoices, payments] = await Promise.all([s.units(propertyId), s.tenants(propertyId), s.invoices(propertyId, year), s.paymentsForProperty(propertyId)]);
  return { property, units, ...computeStatements(units, tenants, invoices, year, settingsOf(property), new Date(), payments) };
}

app.get("/api/properties/:id/preview", async (req, res) => {
  const year = num(req.query.year);
  const r = await compute(req, num(req.params.id), year);
  if (!r) return res.status(404).end();
  res.json({ year, summary: r.summary, units: r.units.map((u) => {
    const own = r.statements.filter((s) => s.unit.id === u.id);
    return { unit_id: u.id, tenants_cents: own.reduce((a, s) => a + s.total_cents, 0), prepaid_cents: own.reduce((a, s) => a + s.prepaid_cents, 0), balance_cents: own.reduce((a, s) => a + s.balance_cents, 0) };
  }) });
});

const withLines = (s: Statement) => ({ ...s, lines: parseJson<StatementLine[]>(s.lines_json, []), lines_json: undefined });
async function runPayload(req: Request, propertyId: number, year: number) {
  const [run, statements] = await Promise.all([st(req).run(propertyId, year), st(req).statements(propertyId, year)]);
  return {
    statements: statements.map(withLines),
    summary: run ? parseJson(run.summary_json, null) : null,
    checks: run ? parseJson(run.checks_json, []) : [],
    created_at: run?.created_at ?? null,
  };
}

app.post("/api/properties/:id/statements/generate", async (req, res) => {
  const propertyId = num(req.params.id), year = num(req.body?.year);
  if (!Number.isFinite(year)) return res.status(400).json({ error: "year missing" });
  const r = await compute(req, propertyId, year);
  if (!r) return res.status(404).end();
  const now = new Date().toISOString();
  await st(req).upsert("statements", r.statements.map((s) => ({
    tenant_id: s.tenant.id, year, total_cents: s.total_cents, prepaid_cents: s.prepaid_cents, balance_cents: s.balance_cents,
    suggested_prepayment_cents: s.suggested_prepayment_cents, lines_json: s.lines, created_at: now, sent_at: null,
  })), "tenant_id,year");
  await st(req).upsert("runs", [{ property_id: propertyId, year, summary_json: r.summary, checks_json: r.checks, created_at: now }], "property_id,year");
  res.json(await runPayload(req, propertyId, year));
});
app.get("/api/properties/:id/statements", async (req, res) => {
  res.json(await runPayload(req, num(req.params.id), num(req.query.year)));
});

async function buildTenantStatement(req: Request, sid: number) {
  const s = await st(req).statement(sid);
  if (!s) return null;
  const tenant = (await st(req).tenant(s.tenant_id))!, unit = (await st(req).unit(tenant.unit_id))!, property = (await st(req).property(unit.property_id))!;
  const payments = (await st(req).payments(tenant.id)).filter((p) => p.paid_on.startsWith(String(s.year)));
  return { s, property, ts: { tenant, unit, year: s.year, lines: parseJson<StatementLine[]>(s.lines_json, []), total_cents: s.total_cents, prepaid_cents: s.prepaid_cents, months_occupied: occupiedMonths(tenant, s.year), prepaid_from_payments: payments.length > 0, payments, balance_cents: s.balance_cents, suggested_prepayment_cents: s.suggested_prepayment_cents } };
}

app.patch("/api/statements/:id/payment", async (req, res) => {
  const s = await st(req).statement(num(req.params.id));
  if (!s) return res.status(404).end();
  const b = req.body ?? {};
  const status = ["open", "paid", "refunded", "waived"].includes(b.status) ? b.status : s.payment_status;
  const updated = await st(req).update<Statement>("statements", s.id, {
    payment_status: status,
    paid_at: status === "open" ? null : (isoOrNull(b.paid_at) ?? s.paid_at ?? new Date().toISOString().slice(0, 10)),
    paid_cents: status === "open" ? null : (b.paid_cents === undefined || b.paid_cents === "" ? (s.paid_cents ?? Math.abs(s.balance_cents)) : Math.round(Number(b.paid_cents))),
    payment_note: "note" in b ? (b.note ? String(b.note).slice(0, 300) : null) : s.payment_note,
  });
  res.json(updated && withLines(updated));
});

app.get("/api/statements/:id/pdf", async (req, res) => {
  const b = await buildTenantStatement(req, num(req.params.id));
  if (!b) return res.status(404).end();
  const pdf = await statementPdf(b.property, b.ts, `${APP_URL()}/portal/${b.ts.tenant.portal_token}`, (await st(req).organization()) ?? {});
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Abrechnung-${b.s.year}-${b.ts.unit.label.replace(/\W+/g, "_")}.pdf"`);
  res.send(pdf);
});

app.post("/api/statements/:id/send", async (req, res) => {
  const b = await buildTenantStatement(req, num(req.params.id));
  if (!b) return res.status(404).end();
  // A statement with unresolved blockers must not go out.
  const run = await st(req).run(b.property.id, b.s.year);
  const blockers = run ? parseJson<{ level: string; message: string }[]>(run.checks_json, []).filter((c) => c.level === "BLOCKER") : [];
  if (blockers.length) return res.status(409).json({ error: `Blocked: ${blockers.map((c) => c.message).join(" ")}` });
  const portalUrl = `${APP_URL()}/portal/${b.ts.tenant.portal_token}`;
  const org = (await st(req).organization()) ?? {};
  const pdf = await statementPdf(b.property, b.ts, portalUrl, org);
  const bal = b.ts.balance_cents;
  await sendMail({
    to: { email: b.ts.tenant.email, name: b.ts.tenant.name },
    subject: `Betriebskostenabrechnung ${b.s.year} – ${b.property.name}, ${b.ts.unit.label}`,
    html: `<p>Guten Tag ${b.ts.tenant.name},</p>
<p>anbei erhalten Sie Ihre Betriebskostenabrechnung für ${b.s.year}.</p>
<p><strong>${bal > 0 ? `Nachzahlung: ${eur(bal)}` : `Guthaben: ${eur(-bal)}`}</strong></p>
<p>Jede Position können Sie mit Originalbeleg im Mieterportal nachvollziehen:<br><a href="${portalUrl}">${portalUrl}</a><br>
${b.ts.tenant.registered_at
  ? `Oder melden Sie sich unter <a href="${APP_URL()}/login">${APP_URL()}/login</a> mit Ihrer E-Mail und Ihrem Passwort an.</p>`
  : `Oder registrieren Sie sich einmalig unter <a href="${APP_URL()}/login">${APP_URL()}/login</a> — E-Mail: ${b.ts.tenant.email}, Registrierungscode: <strong>${b.ts.tenant.access_code}</strong>. Danach melden Sie sich mit Ihrem Passwort an.</p>`}
<p>Mit freundlichen Grüßen<br>${String((org as { landlord_name?: string }).landlord_name || (org as { name?: string }).name || "Ihre Hausverwaltung")}</p>`,
    attachment: { name: `Betriebskostenabrechnung-${b.s.year}.pdf`, content: pdf },
  });
  const u = await st(req).update<Statement>("statements", b.s.id, { sent_at: new Date().toISOString() });
  res.json({ ok: true, sent_at: u?.sent_at ?? null });
});

// ---------- static frontend (production) ----------
const dist = path.resolve("client/dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

// ---------- errors ----------
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof DbError ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "internal error" : (err as Error).message });
});

const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3000);
app.listen(port, () => console.log(`api listening on :${port}`));
