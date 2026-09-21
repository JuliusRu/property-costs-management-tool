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
- allocable: boolean — false if the cost is NOT allocable to tenants under §2 BetrKV (e.g. Verwaltungskosten, Instandhaltung/Reparaturen, Bankgebühren)
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
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.5))),
    notes: String(parsed.notes ?? "").slice(0, 500),
  };
}
