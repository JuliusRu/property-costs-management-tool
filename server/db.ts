// Domain types and constants shared by the engine, the store and the API.
// Data lives in Supabase (Postgres + RLS) — see supabase/migrations and server/store.ts.

/** jsonb columns arrive as objects from Postgres; tests and old data may still pass JSON strings. */
export type Json = string | Record<string, unknown> | unknown[] | null;
export function parseJson<T>(v: unknown, fallback: T): T {
  if (v == null || v === "") return fallback;
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return fallback; } }
  return v as T;
}

// Allocation keys according to German BetrKV practice.
export type AllocationKey = "area" | "mea" | "persons" | "units" | "heating" | "water";
// Which units take part in a cost: every unit, apartments only (e.g. waste when the shop has its own bins), commercial only.
export type Pool = "all" | "residential" | "commercial";

// § 2 BetrKV catalogue (numbers in comments = § 2 Nr.)
export const CATEGORIES = [
  "property_tax",     // 1
  "water_sewage",     // 2, 3 — metered water and sewage
  "rainwater",        // 3 — Niederschlagswasser, by sealed area, not consumption
  "heating",          // 4
  "hot_water",        // 5
  "elevator",         // 7
  "street_cleaning",  // 8
  "waste",            // 8
  "cleaning",         // 9
  "pest_control",     // 9
  "garden",           // 10
  "lighting",         // 11 — Allgemeinstrom
  "chimney",          // 12
  "insurance",        // 13 — Sach- und Haftpflichtversicherung
  "caretaker",        // 14
  "cable",            // 15 — NOT allocable for periods from 1 July 2024 (TKG amendment)
  "laundry",          // 16
  "other",            // 17 — must be named explicitly in the lease
] as const;
export type Category = (typeof CATEGORIES)[number];

// Default key per category (landlord can override per invoice).
export const DEFAULT_KEY: Record<Category, AllocationKey> = {
  property_tax: "area",
  water_sewage: "water",
  rainwater: "area",
  heating: "heating",
  hot_water: "water",
  elevator: "area",
  street_cleaning: "area",
  waste: "persons",
  cleaning: "area",
  pest_control: "area",
  garden: "area",
  lighting: "area",
  chimney: "units",
  insurance: "area",
  caretaker: "area",
  cable: "units",
  laundry: "units",
  other: "area",
};

// ---- building-level settings that change which legal rules apply ----
export const HEATING_TYPES = ["gas", "oil", "district", "heat_pump", "pellets", "decentral"] as const;
export type HeatingType = (typeof HEATING_TYPES)[number];
// kg CO₂ per kWh of fuel — used for the CO2KostAufG stage. District heating varies by network; 0.28 is a common default.
export const CO2_FACTOR: Record<HeatingType, number> = { gas: 0.201, oil: 0.266, district: 0.28, heat_pump: 0, pellets: 0.023, decentral: 0 };
export type PropertySettings = {
  heating_type: HeatingType;
  consumption_share: number;       // HeizkostenV § 7: 0.5 – 0.7 of heating costs by consumption
  hot_water_central: boolean;      // hot water produced by the central heating (§ 9 combined system)
  heizkv_exempt: boolean;          // § 11 HeizkostenV: two-unit building with the landlord living in it → free allocation
  heated_area_sqm: number | null;  // for the CO₂ stage; defaults to the sum of unit areas
};
export const DEFAULT_SETTINGS: PropertySettings = { heating_type: "gas", consumption_share: 0.7, hot_water_central: true, heizkv_exempt: false, heated_area_sqm: null };


export type Property = { id: number; org_id?: string; name: string; address: string; country: string; settings_json: Json };
export type UnitType = "residential" | "commercial" | "garage";
export type Unit = {
  id: number; org_id?: string; property_id: number; label: string; unit_type: UnitType; area_sqm: number; mea: number;
  persons: number; heating_kwh: number; water_m3: number;
};
export type Tenant = {
  id: number; org_id?: string; unit_id: number; name: string; email: string;
  monthly_prepayment_cents: number; move_in: string | null; move_out: string | null; portal_token: string; access_code: string;
  lease_json: Json; password_hash?: string | null; registered_at: string | null;
};

// Rules read from (or typed in from) the lease. They rank above the building default — a lease-agreed key binds the landlord.
export type LeaseClause = { topic: string; quote: string; page: number | null };
export type LeaseRules = {
  prepayment_type: "vorauszahlung" | "pauschale"; // Pauschale = flat rate, no annual statement (§ 556 (2) BGB)
  key_overrides: Partial<Record<Category, AllocationKey>>;
  excluded_categories: Category[];               // cost types the lease does not pass on
  clauses: LeaseClause[];
  source_file: string | null;
  confirmed: boolean;
};
export const DEFAULT_LEASE: LeaseRules = { prepayment_type: "vorauszahlung", key_overrides: {}, excluded_categories: [], clauses: [], source_file: null, confirmed: false };
export function leaseOf(t: Pick<Tenant, "lease_json">): LeaseRules {
  return { ...DEFAULT_LEASE, ...parseJson<Partial<LeaseRules>>(t.lease_json, {}) };
}
export type Invoice = {
  id: number; org_id?: string; property_id: number; unit_id: number | null; provider: string; category: Category;
  description: string | null; amount_cents: number; period_start: string;
  period_end: string; allocation_key: AllocationKey; pool: Pool; allocable: number;
  non_allocable_cents: number; non_allocable_reason: string | null;
  co2_cents: number; energy_kwh: number;
  source: string; file_name: string | null; ai_confidence: number | null;
  ai_notes: string | null; created_at: string;
};
export type Statement = {
  id: number; org_id?: string; tenant_id: number; year: number; total_cents: number;
  prepaid_cents: number; balance_cents: number; suggested_prepayment_cents: number;
  payment_status: "open" | "paid" | "refunded" | "waived"; paid_at: string | null; paid_cents: number | null; payment_note: string | null; lines_json: Json;
  created_at: string; sent_at: string | null;
};

export function settingsOf(p: Pick<Property, "settings_json">): PropertySettings {
  return { ...DEFAULT_SETTINGS, ...parseJson<Partial<PropertySettings>>(p.settings_json, {}) };
}

export const DOC_KINDS = ["invoice", "contract", "notice", "insurance", "meter", "correspondence", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export type Document = {
  id: number; org_id?: string; property_id: number; kind: DocKind; title: string; provider: string | null; doc_date: string | null;
  amount_cents: number | null; tenant_id: number | null; invoice_id: number | null; file_name: string; mime: string;
  size_bytes: number; notes: string | null; created_at: string;
};

export type Payment = { id: number; org_id?: string; tenant_id: number; paid_on: string; amount_cents: number; note: string | null; created_at: string };
export type Run = { property_id: number; year: number; summary_json: Json; checks_json: Json; created_at: string };
