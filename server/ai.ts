import { CATEGORIES, DEFAULT_KEY, type AllocationKey, type Category, type Pool } from "./db.js";

export type Extraction = {
  provider: string;
  category: Category;
  description: string;
  amount_cents: number;
  period_start: string;
  period_end: string;
  allocation_key: AllocationKey;
  pool: Pool;
  allocable: boolean;
  non_allocable_cents: number;
  non_allocable_reason: string;
  co2_cents: number;
  energy_kwh: number;
  meter_note: string;
  confidence: number;
  notes: string;
};

const SYSTEM = `You extract cost positions from documents a German landlord receives for a rental building: utility invoices, municipal fee notices (Gebührenbescheid), service invoices. A file may contain SEVERAL documents (a scanned stack) and one document may contain SEVERAL cost types (e.g. a municipal notice with water, sewage and rainwater). Scanned pages may repeat — treat repeated pages as ONE document.
Return ONLY a JSON object: { "positions": [ ... ], "notes": "..." } where each position has:
- provider: company/authority that issued the document
- category: one of ${CATEGORIES.join(", ")}. Water and sewage (Schmutzwasser) go together as water_sewage; rainwater (Niederschlagswasser) is a SEPARATE position "rainwater"; gas/oil/district heating is "heating".
- description: short label, e.g. "Wasser + Abwasser 2025"
- amount_cents: the GROSS charge for the billing period in cents, VAT included. This is the "Abrechnung"/"Rechnungsbetrag"/"Bruttobetrag" for the period — NEVER the refund or additional payment (Erstattung/Nachzahlung), NEVER prepayments already made (Abschläge/Vorauszahlungen/bisherige Festsetzung), NEVER next year's instalments.
- period_start, period_end: ISO dates of the billing period. Year only → Jan 1 – Dec 31.
- allocation_key: area | mea | persons | units | heating | water — the usual key (mea = Miteigentumsanteile, if the document allocates by co-ownership shares)
- pool: "all" | "residential" | "commercial" — "residential" if the document says the cost concerns apartments only (e.g. waste when the shop has its own contract), else "all" under BetrKV/HeizkostenV practice (rainwater → area, water/sewage → water if sub-meters exist, heating → heating)
- allocable: false only if the WHOLE position is not allocable under § 2 BetrKV
- non_allocable_cents: gross amount of non-allocable items mixed into this position (repairs, admin), else 0
- non_allocable_reason: short English reason or ""
- co2_cents: for heating fuel documents: the CO₂ price component ("CO2-Preis", "CO2-Kosten") as GROSS cents (add the document's VAT rate if the component is shown net), else 0
- energy_kwh: delivered energy in kWh for heating fuel, else 0
- meter_note: "" or a short English note if the document shows only a main meter (Hauptzähler) and no sub-meters — then per-unit consumption is not available
- confidence: 0..1
notes: one or two English sentences about anything the landlord should check (duplicated pages, ambiguous amounts, two owners, etc.).
No prose, no markdown fences.`;

type ModelInput = { text?: string; imageBase64?: string; pdfBase64?: string; mime?: string; fileName: string };

async function callModel(system: string, input: ModelInput, maxText = 20000): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const model = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5";
  const content: unknown[] = [{ type: "text", text: `File name: ${input.fileName}` }];
  if (input.text) content.push({ type: "text", text: `Document text:\n${input.text.slice(0, maxText)}` });
  if (input.imageBase64) content.push({ type: "image_url", image_url: { url: `data:${input.mime ?? "image/png"};base64,${input.imageBase64}` } });
  // Scans without a usable text layer: hand the PDF itself to the model (OpenRouter file input; the model reads the pages).
  if (input.pdfBase64) content.push({ type: "file", file: { filename: input.fileName, file_data: `data:application/pdf;base64,${input.pdfBase64}` } });
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.APP_URL ?? "http://localhost", "X-Title": "Billnest" },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content }], ...(input.pdfBase64 ? { plugins: [{ id: "file-parser", pdf: { engine: "native" } }] } : {}) }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  return (json.choices[0]?.message?.content ?? "").replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
}

/** Reads one file and returns every cost position found in it (a stack of scans → several). */
export async function extractInvoices(input: ModelInput): Promise<{ positions: Extraction[]; notes: string }> {
  const raw = await callModel(SYSTEM, input);
  const parsed = JSON.parse(raw) as { positions?: Partial<Extraction>[]; notes?: string } | Partial<Extraction>;
  const list = Array.isArray((parsed as { positions?: unknown }).positions) ? (parsed as { positions: Partial<Extraction>[] }).positions : [parsed as Partial<Extraction>];
  const notes = String((parsed as { notes?: string }).notes ?? "").slice(0, 500);
  return { positions: list.map(coerceExtraction).filter((p) => p.amount_cents !== 0 || p.provider), notes };
}
export async function extractInvoice(input: ModelInput): Promise<Extraction> {
  const { positions, notes } = await extractInvoices(input);
  if (!positions.length) throw new Error("no cost position found in the document");
  return { ...positions[0], notes: [positions[0].notes, notes].filter(Boolean).join(" ") };
}

// Never trust the model blindly — coerce into our enums and sane defaults.
export function coerceExtraction(parsed: Partial<Extraction>): Extraction {
  const category = (CATEGORIES as readonly string[]).includes(parsed.category ?? "") ? (parsed.category as Category) : "other";
  const keys: AllocationKey[] = ["area", "mea", "persons", "units", "heating", "water"];
  const allocation_key = keys.includes(parsed.allocation_key as AllocationKey) ? (parsed.allocation_key as AllocationKey) : DEFAULT_KEY[category];
  const pool = ["all", "residential", "commercial"].includes(String((parsed as { pool?: string }).pool)) ? (parsed as { pool: Pool }).pool : "all";
  const iso = (s: unknown, fallback: string) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback);
  const year = new Date().getFullYear() - 1;
  return {
    provider: String(parsed.provider ?? "Unknown").slice(0, 120),
    category,
    description: String(parsed.description ?? "").slice(0, 200),
    amount_cents: Math.round(Number(parsed.amount_cents ?? 0)) || 0, // may be negative for credit notes
    period_start: iso(parsed.period_start, `${year}-01-01`),
    period_end: iso(parsed.period_end, `${year}-12-31`),
    allocation_key,
    pool,
    allocable: parsed.allocable !== false,
    non_allocable_cents: Math.max(0, Math.round(Number(parsed.non_allocable_cents ?? 0)) || 0),
    non_allocable_reason: String(parsed.non_allocable_reason ?? "").slice(0, 200),
    co2_cents: Math.max(0, Math.round(Number(parsed.co2_cents ?? 0)) || 0),
    energy_kwh: Math.max(0, Number(parsed.energy_kwh ?? 0) || 0),
    meter_note: String(parsed.meter_note ?? "").slice(0, 200),
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.5))),
    notes: String(parsed.notes ?? "").slice(0, 500),
  };
}

// ---------- lease extraction ----------
export type LeaseExtraction = {
  tenant_name: string;
  unit_hint: string;
  move_in: string | null;
  move_out: string | null;
  monthly_prepayment_cents: number;
  prepayment_type: "vorauszahlung" | "pauschale";
  key_overrides: Partial<Record<Category, AllocationKey>>;
  excluded_categories: Category[];
  clauses: { topic: string; quote: string; page: number | null }[];
  confidence: number;
  notes: string;
};

const LEASE_SYSTEM = `You read German residential lease agreements (Mietverträge) for a landlord's operating-cost tool.
Return ONLY a JSON object:
- tenant_name: full name(s) of the tenant(s)
- unit_hint: how the flat is described (floor, position, e.g. "1. OG links")
- move_in: ISO date the tenancy starts (Mietbeginn), null if absent
- move_out: ISO end date for fixed-term leases, else null
- monthly_prepayment_cents: monthly operating-cost prepayment (Betriebskostenvorauszahlung / Nebenkostenvorauszahlung) in cents — NOT the rent; include heating prepayment if listed separately
- prepayment_type: "pauschale" if the lease agrees a flat rate (Betriebskostenpauschale, no annual statement), else "vorauszahlung"
- key_overrides: object mapping cost categories to the allocation key the lease explicitly agrees, ONLY where it deviates from "by area" or is stated explicitly. Categories: ${CATEGORIES.join(", ")}. Keys: area, persons, units, heating, water.
- excluded_categories: cost categories the lease explicitly does NOT pass on to the tenant (empty if the lease refers to § 2 BetrKV in full)
- clauses: array of the relevant clauses VERBATIM, each { topic (short English label), quote (exact German wording), page (number or null) }. Include the Betriebskosten clause, the allocation key clause, and any special rule (Sondervereinbarung).
- confidence: 0..1
- notes: one or two English sentences on anything ambiguous
Never invent clauses. If a value is not in the document, use null / empty.`;

export async function extractLease(input: { text: string; fileName: string }): Promise<LeaseExtraction> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const model = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.APP_URL ?? "http://localhost", "X-Title": "Billnest" },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: "system", content: LEASE_SYSTEM }, { role: "user", content: `File: ${input.fileName}\n\n${input.text.slice(0, 60000)}` }] }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  const raw = (json.choices[0]?.message?.content ?? "").replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
  return coerceLease(JSON.parse(raw));
}

export function coerceLease(p: Partial<LeaseExtraction>): LeaseExtraction {
  const keys: AllocationKey[] = ["area", "persons", "units", "heating", "water"];
  const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const overrides: Partial<Record<Category, AllocationKey>> = {};
  for (const [c, k] of Object.entries(p.key_overrides ?? {})) if ((CATEGORIES as readonly string[]).includes(c) && keys.includes(k as AllocationKey)) overrides[c as Category] = k as AllocationKey;
  return {
    tenant_name: String(p.tenant_name ?? "").slice(0, 120),
    unit_hint: String(p.unit_hint ?? "").slice(0, 120),
    move_in: iso(p.move_in), move_out: iso(p.move_out),
    monthly_prepayment_cents: Math.max(0, Math.round(Number(p.monthly_prepayment_cents ?? 0)) || 0),
    prepayment_type: p.prepayment_type === "pauschale" ? "pauschale" : "vorauszahlung",
    key_overrides: overrides,
    excluded_categories: (Array.isArray(p.excluded_categories) ? p.excluded_categories : []).filter((c): c is Category => (CATEGORIES as readonly string[]).includes(String(c))),
    clauses: (Array.isArray(p.clauses) ? p.clauses : []).slice(0, 12).map((c) => ({ topic: String(c?.topic ?? "").slice(0, 80), quote: String(c?.quote ?? "").slice(0, 1200), page: Number.isFinite(Number(c?.page)) ? Number(c.page) : null })),
    confidence: Math.min(1, Math.max(0, Number(p.confidence ?? 0.5))),
    notes: String(p.notes ?? "").slice(0, 500),
  };
}

// ---------- generic document classification for the archive ----------
export type DocClassification = { kind: "invoice" | "contract" | "notice" | "insurance" | "meter" | "correspondence" | "other"; title: string; provider: string; doc_date: string | null; amount_cents: number | null; confidence: number };
export async function classifyDocument(input: { text?: string; imageBase64?: string; mime?: string; fileName: string }): Promise<DocClassification> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const model = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5";
  const content: unknown[] = [];
  if (input.text) content.push({ type: "text", text: `File name: ${input.fileName}\n\n${input.text.slice(0, 12000)}` });
  if (input.imageBase64) { content.push({ type: "text", text: `File name: ${input.fileName}` }); content.push({ type: "image_url", image_url: { url: `data:${input.mime ?? "image/png"};base64,${input.imageBase64}` } }); }
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": process.env.APP_URL ?? "http://localhost", "X-Title": "Billnest" },
    body: JSON.stringify({ model, temperature: 0, messages: [
      { role: "system", content: `Classify a document from a German landlord's files. Return ONLY JSON: { kind: one of invoice, contract, notice (official notice such as Grundsteuerbescheid/Gebührenbescheid), insurance (policy or certificate), meter (meter reading / Ablesung), correspondence, other; title: short German title (max 60 chars, e.g. "Grundsteuerbescheid 2025"); provider: sender/company; doc_date: ISO date of the document or null; amount_cents: total amount in cents if it is an invoice or notice with an amount, else null; confidence: 0..1 }` },
      { role: "user", content },
    ] }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  const raw = (json.choices[0]?.message?.content ?? "").replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
  const p = JSON.parse(raw) as Partial<DocClassification>;
  const kinds = ["invoice", "contract", "notice", "insurance", "meter", "correspondence", "other"];
  return {
    kind: kinds.includes(String(p.kind)) ? (p.kind as DocClassification["kind"]) : "other",
    title: String(p.title ?? "").slice(0, 120), provider: String(p.provider ?? "").slice(0, 120),
    doc_date: typeof p.doc_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.doc_date) ? p.doc_date : null,
    amount_cents: p.amount_cents == null ? null : Math.max(0, Math.round(Number(p.amount_cents)) || 0),
    confidence: Math.min(1, Math.max(0, Number(p.confidence ?? 0.5))),
  };
}

/** No-AI fallback: keyword classification from the text layer. Good enough to sort the archive; the landlord can correct. */
export function heuristicClassify(text: string, fileName: string): DocClassification {
  const t = `${fileName}\n${text}`.toLowerCase();
  const kind: DocClassification["kind"] =
    /mietvertrag|mietvertrages|vertrag/.test(t) ? "contract" :
    /bescheid/.test(t) ? "notice" :
    /versicherung|police|versicherungsschein/.test(t) ? "insurance" :
    /zählerstand|zaehlerstand|ablesung|zähler/.test(t) ? "meter" :
    /rechnung|invoice|abrechnung|gebühren/.test(t) ? "invoice" :
    /sehr geehrte|mit freundlichen grüßen/.test(t) ? "correspondence" : "other";
  const dateM = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  const doc_date = dateM ? `${dateM[3]}-${dateM[2]}-${dateM[1]}` : null;
  const amounts = [...text.matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2})\s*€/g)].map((m) => Math.round(Number(m[1].replace(/\./g, "").replace(",", ".")) * 100));
  const amount_cents = kind === "invoice" || kind === "notice" ? (amounts.length ? Math.max(...amounts) : null) : null;
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 3 && l.length < 80) ?? "";
  const titleM = text.match(/^(.*(?:bescheid|rechnung|vertrag|police|versicherungsschein|ablesung)[^\n]{0,40})$/im);
  return { kind, title: (titleM?.[1] ?? fileName.replace(/\.[^.]+$/, "")).trim().slice(0, 120), provider: firstLine.split("·")[0].trim().slice(0, 120), doc_date, amount_cents, confidence: 0.4 };
}
