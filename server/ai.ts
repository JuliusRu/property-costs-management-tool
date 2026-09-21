import { CATEGORIES, DEFAULT_KEY, type AllocationKey, type Category } from "./db.js";

export type Extraction = {
  provider: string;
  category: Category;
  description: string;
  amount_cents: number;
  period_start: string;
  period_end: string;
  allocation_key: AllocationKey;
  allocable: boolean;
  non_allocable_cents: number;
  non_allocable_reason: string;
  co2_cents: number;
  energy_kwh: number;
  confidence: number;
  notes: string;
};

const SYSTEM = `You extract data from German utility / operating-cost invoices (Nebenkosten, Betriebskosten) for a landlord.
Return ONLY a JSON object with these fields:
- provider: company that issued the invoice
- category: one of ${CATEGORIES.join(", ")}
- description: short label, e.g. "Wasser/Abwasser 2025"
- amount_cents: gross total in euro cents (integer). Use the amount the landlord actually has to pay.
- period_start, period_end: ISO dates (YYYY-MM-DD) of the billing period. If only a year is given use Jan 1 – Dec 31.
- allocation_key: one of area, persons, units, heating, water — how this cost is distributed to tenants under German BetrKV/HeizkostenV practice
- allocable: boolean — false if the WHOLE invoice is NOT allocable to tenants under §2 BetrKV (e.g. pure Verwaltungskosten, Instandhaltung, Bankgebühren)
- non_allocable_cents: integer — if the invoice MIXES allocable and non-allocable items (e.g. a caretaker invoice that also bills a repair), the gross amount of the non-allocable items in cents (include their share of VAT). 0 if none.
- non_allocable_reason: short English reason for the excluded part, empty string if none
- co2_cents: for heating fuel invoices (gas, oil, district heating): the CO₂ price component in cents if the invoice states it ("CO2-Kosten", "CO2-Preis", "Emissionskosten"), else 0
- energy_kwh: for heating fuel invoices: delivered energy in kWh (number), else 0
- if the invoice mixes water/sewage (by consumption) with rainwater/Niederschlagswasser (by area), say so in notes — the landlord may split it
- confidence: 0..1
- notes: one sentence, in English, on anything the landlord should double-check
No prose, no markdown fences.`;

export async function extractInvoice(input: { text?: string; imageBase64?: string; mime?: string; fileName: string }): Promise<Extraction> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const model = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5";

  const content: unknown[] = [];
  if (input.text) content.push({ type: "text", text: `File name: ${input.fileName}\n\nInvoice text:\n${input.text.slice(0, 20000)}` });
  if (input.imageBase64) {
    content.push({ type: "text", text: `File name: ${input.fileName}. Read the invoice in the image.` });
    content.push({ type: "image_url", image_url: { url: `data:${input.mime ?? "image/png"};base64,${input.imageBase64}` } });
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL ?? "http://localhost",
      "X-Title": "Property Costs Management Tool",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  const raw = json.choices[0]?.message?.content ?? "";
  const cleaned = raw.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<Extraction>;

  // Never trust the model blindly — coerce into our enums and sane defaults.
  const category = (CATEGORIES as readonly string[]).includes(parsed.category ?? "") ? (parsed.category as Category) : "other";
  const keys: AllocationKey[] = ["area", "persons", "units", "heating", "water"];
  const allocation_key = keys.includes(parsed.allocation_key as AllocationKey) ? (parsed.allocation_key as AllocationKey) : DEFAULT_KEY[category];
  const iso = (s: unknown, fallback: string) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback);
  const year = new Date().getFullYear() - 1;
  return {
    provider: String(parsed.provider ?? "Unknown").slice(0, 120),
    category,
    description: String(parsed.description ?? "").slice(0, 200),
    amount_cents: Math.max(0, Math.round(Number(parsed.amount_cents ?? 0))),
    period_start: iso(parsed.period_start, `${year}-01-01`),
    period_end: iso(parsed.period_end, `${year}-12-31`),
    allocation_key,
    allocable: parsed.allocable !== false,
    non_allocable_cents: Math.max(0, Math.round(Number(parsed.non_allocable_cents ?? 0))),
    non_allocable_reason: String(parsed.non_allocable_reason ?? "").slice(0, 200),
    co2_cents: Math.max(0, Math.round(Number(parsed.co2_cents ?? 0)) || 0),
    energy_kwh: Math.max(0, Number(parsed.energy_kwh ?? 0) || 0),
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
