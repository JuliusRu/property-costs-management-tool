export type Unit = { id: number; property_id: number; label: string; area_sqm: number; persons: number; heating_kwh: number; water_m3: number };
export type Tenant = { id: number; unit_id: number; name: string; email: string; monthly_prepayment_cents: number; move_in: string | null; move_out: string | null; portal_token: string };
export type Property = { id: number; name: string; address: string; country: string; units: Unit[]; tenants: Tenant[] };
export type Invoice = {
  id: number; property_id: number; provider: string; category: string; description: string | null; amount_cents: number;
  period_start: string; period_end: string; allocation_key: string; allocable: number; source: string; file_name: string | null;
  ai_confidence: number | null; ai_notes: string | null; created_at: string;
};
export type Line = { invoice_id: number; provider: string; category: string; description: string | null; allocation_key: string; total_cents: number; basis_unit: number; basis_total: number; unit_share_cents: number; days_occupied: number; days_in_year: number; share_cents: number; formula: string };
export type Summary = { year: number; invoiced_cents: number; non_allocable_cents: number; allocable_cents: number; tenants_cents: number; owner_vacancy_cents: number; rounding_cents: number };
export type Check = { level: "BLOCKER" | "WARNING" | "INFO"; code: string; message: string; hint?: string };
export type Run = { statements: Statement[]; summary: Summary | null; checks: Check[]; created_at: string | null };
export type Statement = { id: number; tenant_id: number; year: number; total_cents: number; prepaid_cents: number; balance_cents: number; lines: Line[]; created_at: string; sent_at: string | null };
export type Extraction = { provider: string; category: string; description: string; amount_cents: number; period_start: string; period_end: string; allocation_key: string; allocable: boolean; confidence: number; notes: string };

export class ApiError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "same-origin", ...init });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).error ?? msg; } catch { /* ignore */ }
    throw new ApiError(r.status, msg);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  login: (password: string) => req<{ ok: true }>("/api/login", json({ password })),
  logout: () => req("/api/logout", { method: "POST" }),
  me: () => req<{ role: string }>("/api/me"),
  properties: () => req<Property[]>("/api/properties"),
  meta: () => req<{ categories: string[]; default_key: Record<string, string> }>("/api/meta"),
  invoices: (pid: number, year?: number) => req<Invoice[]>(`/api/properties/${pid}/invoices${year ? `?year=${year}` : ""}`),
  createInvoice: (pid: number, body: Partial<Invoice> & { allocable?: boolean; ai_confidence?: number; ai_notes?: string }) => req<Invoice>(`/api/properties/${pid}/invoices`, json(body)),
  updateInvoice: (id: number, body: Partial<Invoice> & { allocable?: boolean }) => req<Invoice>(`/api/invoices/${id}`, { ...json(body), method: "PATCH" }),
  deleteInvoice: (id: number) => req<void>(`/api/invoices/${id}`, { method: "DELETE" }),
  extract: (pid: number, file: File) => { const fd = new FormData(); fd.append("file", file); return req<{ extraction: Extraction; file_name: string }>(`/api/properties/${pid}/invoices/extract`, { method: "POST", body: fd }); },
  sync: (pid: number) => req<{ imported: Invoice[]; errors: string[] }>(`/api/properties/${pid}/invoices/sync`, { method: "POST" }),
  statements: (pid: number, year: number) => req<Run>(`/api/properties/${pid}/statements?year=${year}`),
  generate: (pid: number, year: number) => req<Run>(`/api/properties/${pid}/statements/generate`, json({ year })),
  reset: () => req<{ ok: true }>("/api/reset", { method: "POST" }),
  send: (sid: number) => req<{ ok: true; sent_at: string }>(`/api/statements/${sid}/send`, { method: "POST" }),
  portal: (token: string) => req<{ tenant: { name: string; email: string; monthly_prepayment_cents: number }; unit: Unit; property: { id: number; name: string; address: string }; statements: Statement[] }>(`/api/portal/${token}`),
};

export const eur = (cents: number) => (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
export const CATEGORY_LABEL: Record<string, string> = {
  property_tax: "Property tax", water_sewage: "Water & sewage", heating: "Heating", hot_water: "Hot water", waste: "Waste collection",
  cleaning: "Building cleaning", garden: "Garden", lighting: "Lighting", chimney: "Chimney sweep", insurance: "Insurance",
  caretaker: "Caretaker", elevator: "Elevator", cable: "Cable/TV", other: "Other",
};
export const KEY_LABEL: Record<string, string> = { area: "by area (m²)", persons: "by persons", units: "per unit", heating: "by heating kWh", water: "by water m³" };
