export type UnitType = "residential" | "commercial" | "garage";
export type Unit = { id: number; property_id: number; label: string; unit_type: UnitType; area_sqm: number; persons: number; heating_kwh: number; water_m3: number };
export type HeatingType = "gas" | "oil" | "district" | "heat_pump" | "pellets" | "decentral";
export type Settings = { heating_type: HeatingType; consumption_share: number; hot_water_central: boolean; heizkv_exempt: boolean; heated_area_sqm: number | null };
export type LeaseClause = { topic: string; quote: string; page: number | null };
export type Lease = { prepayment_type: "vorauszahlung" | "pauschale"; key_overrides: Partial<Record<string, string>>; excluded_categories: string[]; clauses: LeaseClause[]; source_file: string | null; confirmed: boolean };
export type LeaseExtraction = Lease & { tenant_name: string; unit_hint: string; move_in: string | null; move_out: string | null; monthly_prepayment_cents: number; confidence: number; notes: string };
export type Tenant = { id: number; unit_id: number; name: string; email: string; monthly_prepayment_cents: number; move_in: string | null; move_out: string | null; portal_token: string; access_code: string; lease: Lease };
export type Property = { id: number; name: string; address: string; country: string; settings: Settings; units: Unit[]; tenants: Tenant[] };
export type Invoice = {
  id: number; property_id: number; provider: string; category: string; description: string | null; amount_cents: number;
  period_start: string; period_end: string; allocation_key: string; allocable: number; non_allocable_cents: number; non_allocable_reason: string | null; co2_cents: number; energy_kwh: number; source: string; file_name: string | null;
  ai_confidence: number | null; ai_notes: string | null; created_at: string;
};
export type Line = { invoice_id: number; provider: string; category: string; description: string | null; allocation_key: string; total_cents: number; basis_unit: number; basis_total: number; unit_share_cents: number; days_occupied: number; days_in_year: number; share_cents: number; formula: string };
export type Summary = { year: number; invoiced_cents: number; non_allocable_cents: number; allocable_cents: number; tenants_cents: number; owner_vacancy_cents: number; rounding_cents: number; co2_landlord_cents: number; owner_lease_diff_cents: number; legal_basis: string };
export type Check = { level: "BLOCKER" | "WARNING" | "INFO"; code: string; message: string; hint?: string };
export type Run = { statements: Statement[]; summary: Summary | null; checks: Check[]; created_at: string | null };
export type Statement = { id: number; tenant_id: number; year: number; total_cents: number; prepaid_cents: number; balance_cents: number; suggested_prepayment_cents: number; lines: Line[]; created_at: string; sent_at: string | null };
export type Extraction = { provider: string; category: string; description: string; amount_cents: number; period_start: string; period_end: string; allocation_key: string; allocable: boolean; non_allocable_cents: number; non_allocable_reason: string; co2_cents: number; energy_kwh: number; confidence: number; notes: string };

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
  tenantLogin: (email: string, code: string) => req<{ ok: true }>("/api/tenant-login", json({ email, code })),
  tenantLogout: () => req("/api/tenant-logout", { method: "POST" }),
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
  waitlist: (email: string, units: number | null) => req<{ ok: true }>("/api/waitlist", json({ email, units })),
  updateProperty: (id: number, body: { name?: string; address?: string }) => req<Property>(`/api/properties/${id}`, { ...json(body), method: "PATCH" }),
  createProperty: (body: { name: string; address: string }) => req<Property>("/api/properties", json(body)),
  deleteProperty: (id: number) => req<void>(`/api/properties/${id}`, { method: "DELETE" }),
  updateSettings: (id: number, body: Partial<Settings>) => req<Settings>(`/api/properties/${id}/settings`, { ...json(body), method: "PATCH" }),
  extractLease: (tenantId: number, file: File) => { const fd = new FormData(); fd.append("file", file); return req<{ extraction: LeaseExtraction; file_name: string }>(`/api/tenants/${tenantId}/lease/extract`, { method: "POST", body: fd }); },
  sampleLease: (tenantId: number) => req<{ extraction: LeaseExtraction; file_name: string }>(`/api/tenants/${tenantId}/lease/sample`, { method: "POST" }),
  documents: (pid: number) => req<Doc[]>(`/api/properties/${pid}/documents`),
  uploadDocument: (pid: number, file: File, meta?: Record<string, string>) => { const fd = new FormData(); fd.append("file", file); for (const [k, v] of Object.entries(meta ?? {})) fd.append(k, v); return req<Doc>(`/api/properties/${pid}/documents`, { method: "POST", body: fd }); },
  updateDocument: (id: number, body: Partial<Doc>) => req<Doc>(`/api/documents/${id}`, { ...json(body), method: "PATCH" }),
  deleteDocument: (id: number) => req<void>(`/api/documents/${id}`, { method: "DELETE" }),
  extractFromDocument: (id: number) => req<{ extraction: Extraction; file_name: string; document_id: number }>(`/api/documents/${id}/extract-invoice`, { method: "POST" }),
  linkDocumentInvoice: (id: number, invoiceId: number) => req<Doc>(`/api/documents/${id}/link-invoice`, json({ invoice_id: invoiceId })),
  saveLease: (tenantId: number, body: Lease) => req<Lease>(`/api/tenants/${tenantId}/lease`, { ...json(body), method: "PUT" }),
  createUnit: (pid: number, body: Partial<Unit>) => req<Unit>(`/api/properties/${pid}/units`, json(body)),
  updateUnit: (id: number, body: Partial<Unit>) => req<Unit>(`/api/units/${id}`, { ...json(body), method: "PATCH" }),
  deleteUnit: (id: number) => req<void>(`/api/units/${id}`, { method: "DELETE" }),
  createTenant: (unitId: number, body: Partial<Tenant>) => req<Tenant>(`/api/units/${unitId}/tenants`, json(body)),
  updateTenant: (id: number, body: Partial<Tenant>) => req<Tenant>(`/api/tenants/${id}`, { ...json(body), method: "PATCH" }),
  deleteTenant: (id: number) => req<void>(`/api/tenants/${id}`, { method: "DELETE" }),
  send: (sid: number) => req<{ ok: true; sent_at: string }>(`/api/statements/${sid}/send`, { method: "POST" }),
  portalMe: () => req<{ tenant: { name: string; email: string; monthly_prepayment_cents: number }; unit: Unit; property: { id: number; name: string; address: string }; statements: Statement[] }>("/api/portal/me"),
  portal: (token: string) => req<{ tenant: { name: string; email: string; monthly_prepayment_cents: number }; unit: Unit; property: { id: number; name: string; address: string }; statements: Statement[] }>(`/api/portal/${token}`),
};

export const eur = (cents: number) => (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
export type DocKind = "invoice" | "contract" | "notice" | "insurance" | "meter" | "correspondence" | "statement" | "other";
export type Doc = {
  id: number | string; kind: DocKind; title: string; provider: string | null; doc_date: string | null; amount_cents: number | null;
  tenant_id: number | null; tenant_name: string | null; invoice_id: number | null; file_name: string | null; mime: string; size_bytes: number | null;
  notes: string | null; created_at: string; source: string; url: string; booked?: boolean; lease_confirmed?: boolean; ai_confidence?: number;
};
export const DOC_KINDS = ["invoice", "contract", "notice", "insurance", "meter", "correspondence", "statement", "other"] as const;
export const CATEGORIES = ["property_tax", "water_sewage", "rainwater", "heating", "hot_water", "elevator", "street_cleaning", "waste", "cleaning", "pest_control", "garden", "lighting", "chimney", "insurance", "caretaker", "cable", "laundry", "other"] as const;
export const HEATING_TYPES = ["gas", "oil", "district", "heat_pump", "pellets", "decentral"] as const;
export const KEYS = ["area", "persons", "units", "heating", "water"] as const;
