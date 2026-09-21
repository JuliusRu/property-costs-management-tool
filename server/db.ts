import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve("data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "app.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

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

db.exec(`
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'DE',
  settings_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  unit_type TEXT NOT NULL DEFAULT 'residential',
  area_sqm REAL NOT NULL,
  mea REAL NOT NULL DEFAULT 0,
  persons INTEGER NOT NULL DEFAULT 1,
  heating_kwh REAL NOT NULL DEFAULT 0,
  water_m3 REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  monthly_prepayment_cents INTEGER NOT NULL DEFAULT 0,
  move_in TEXT,
  move_out TEXT,
  portal_token TEXT NOT NULL UNIQUE,
  lease_json TEXT NOT NULL DEFAULT '{}',
  password_hash TEXT,
  registered_at TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  amount_cents INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  allocation_key TEXT NOT NULL,
  pool TEXT NOT NULL DEFAULT 'all',
  allocable INTEGER NOT NULL DEFAULT 1,
  non_allocable_cents INTEGER NOT NULL DEFAULT 0,
  non_allocable_reason TEXT,
  co2_cents INTEGER NOT NULL DEFAULT 0,
  energy_kwh REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  file_name TEXT,
  ai_confidence REAL,
  ai_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS runs (
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (property_id, year)
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'other',
  title TEXT NOT NULL,
  provider TEXT,
  doc_date TEXT,
  amount_cents INTEGER,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  units INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  prepaid_cents INTEGER NOT NULL,
  balance_cents INTEGER NOT NULL,
  suggested_prepayment_cents INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'open',
  paid_at TEXT,
  paid_cents INTEGER,
  payment_note TEXT,
  lines_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  UNIQUE(tenant_id, year)
);
`);

// tiny forward-only migrations for databases created before a column existed
for (const stmt of ["ALTER TABLE tenants ADD COLUMN move_in TEXT", "ALTER TABLE tenants ADD COLUMN move_out TEXT",
  "ALTER TABLE invoices ADD COLUMN non_allocable_cents INTEGER NOT NULL DEFAULT 0", "ALTER TABLE invoices ADD COLUMN non_allocable_reason TEXT",
  "ALTER TABLE tenants ADD COLUMN access_code TEXT",
  "ALTER TABLE properties ADD COLUMN settings_json TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE units ADD COLUMN unit_type TEXT NOT NULL DEFAULT 'residential'",
  "ALTER TABLE invoices ADD COLUMN co2_cents INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN energy_kwh REAL NOT NULL DEFAULT 0",
  "ALTER TABLE statements ADD COLUMN suggested_prepayment_cents INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE tenants ADD COLUMN lease_json TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE tenants ADD COLUMN password_hash TEXT",
  "ALTER TABLE tenants ADD COLUMN registered_at TEXT",
  "ALTER TABLE invoices ADD COLUMN unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL",
  "ALTER TABLE statements ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'open'",
  "ALTER TABLE statements ADD COLUMN paid_at TEXT",
  "ALTER TABLE statements ADD COLUMN paid_cents INTEGER",
  "ALTER TABLE statements ADD COLUMN payment_note TEXT",
  "ALTER TABLE units ADD COLUMN mea REAL NOT NULL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN pool TEXT NOT NULL DEFAULT 'all'"]) {
  try { db.exec(stmt); } catch { /* column exists */ }
}

// Tenant access codes: short, human-typeable, no ambiguous characters (0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newAccessCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
for (const row of db.prepare("SELECT id FROM tenants WHERE access_code IS NULL").all() as { id: number }[]) {
  db.prepare("UPDATE tenants SET access_code = ? WHERE id = ?").run(newAccessCode(), row.id);
}

export type Property = { id: number; name: string; address: string; country: string; settings_json: string };
export type UnitType = "residential" | "commercial" | "garage";
export type Unit = {
  id: number; property_id: number; label: string; unit_type: UnitType; area_sqm: number; mea: number;
  persons: number; heating_kwh: number; water_m3: number;
};
export type Tenant = {
  id: number; unit_id: number; name: string; email: string;
  monthly_prepayment_cents: number; move_in: string | null; move_out: string | null; portal_token: string; access_code: string;
  lease_json: string; password_hash: string | null; registered_at: string | null;
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
export function leaseOf(t: Tenant): LeaseRules {
  try { return { ...DEFAULT_LEASE, ...JSON.parse(t.lease_json || "{}") }; } catch { return { ...DEFAULT_LEASE }; }
}
export type Invoice = {
  id: number; property_id: number; unit_id: number | null; provider: string; category: Category;
  description: string | null; amount_cents: number; period_start: string;
  period_end: string; allocation_key: AllocationKey; pool: Pool; allocable: number;
  non_allocable_cents: number; non_allocable_reason: string | null;
  co2_cents: number; energy_kwh: number;
  source: string; file_name: string | null; ai_confidence: number | null;
  ai_notes: string | null; created_at: string;
};
export type Statement = {
  id: number; tenant_id: number; year: number; total_cents: number;
  prepaid_cents: number; balance_cents: number; suggested_prepayment_cents: number;
  payment_status: "open" | "paid" | "refunded" | "waived"; paid_at: string | null; paid_cents: number | null; payment_note: string | null; lines_json: string;
  created_at: string; sent_at: string | null;
};

export function settingsOf(p: Property): PropertySettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(p.settings_json || "{}") }; } catch { return { ...DEFAULT_SETTINGS }; }
}

export const DOC_KINDS = ["invoice", "contract", "notice", "insurance", "meter", "correspondence", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export type Document = {
  id: number; property_id: number; kind: DocKind; title: string; provider: string | null; doc_date: string | null;
  amount_cents: number | null; tenant_id: number | null; invoice_id: number | null; file_name: string; mime: string;
  size_bytes: number; notes: string | null; created_at: string;
};

export const q = {
  documents: (propertyId: number) => db.prepare("SELECT * FROM documents WHERE property_id = ? ORDER BY COALESCE(doc_date, created_at) DESC, id DESC").all(propertyId) as unknown as Document[],
  document: (id: number) => db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as unknown as Document | undefined,
  properties: () => db.prepare("SELECT * FROM properties ORDER BY id").all() as unknown as Property[],
  property: (id: number) => db.prepare("SELECT * FROM properties WHERE id = ?").get(id) as unknown as Property | undefined,
  units: (propertyId: number) => db.prepare("SELECT * FROM units WHERE property_id = ? ORDER BY id").all(propertyId) as unknown as Unit[],
  unit: (id: number) => db.prepare("SELECT * FROM units WHERE id = ?").get(id) as unknown as Unit | undefined,
  allTenants: () => db.prepare("SELECT t.*, u.label AS unit_label, u.property_id, p.name AS property_name FROM tenants t JOIN units u ON u.id = t.unit_id JOIN properties p ON p.id = u.property_id ORDER BY p.name, u.id, t.move_in").all() as unknown as (Tenant & { unit_label: string; property_id: number; property_name: string })[],
  tenants: (propertyId: number) =>
    db.prepare("SELECT t.* FROM tenants t JOIN units u ON u.id = t.unit_id WHERE u.property_id = ? ORDER BY t.id").all(propertyId) as unknown as Tenant[],
  tenant: (id: number) => db.prepare("SELECT * FROM tenants WHERE id = ?").get(id) as unknown as Tenant | undefined,
  tenantByEmail: (email: string) => db.prepare("SELECT * FROM tenants WHERE lower(email) = lower(?)").all(email) as unknown as Tenant[],
  tenantByToken: (token: string) => db.prepare("SELECT * FROM tenants WHERE portal_token = ?").get(token) as unknown as Tenant | undefined,
  invoices: (propertyId: number, year?: number) =>
    (year
      ? db.prepare("SELECT * FROM invoices WHERE property_id = ? AND substr(period_start,1,4) = ? ORDER BY period_start, id").all(propertyId, String(year))
      : db.prepare("SELECT * FROM invoices WHERE property_id = ? ORDER BY period_start DESC, id DESC").all(propertyId)) as unknown as Invoice[],
  invoice: (id: number) => db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as unknown as Invoice | undefined,
  statements: (propertyId: number, year: number) =>
    db.prepare("SELECT s.* FROM statements s JOIN tenants t ON t.id = s.tenant_id JOIN units u ON u.id = t.unit_id WHERE u.property_id = ? AND s.year = ? ORDER BY u.id").all(propertyId, year) as unknown as Statement[],
  statement: (id: number) => db.prepare("SELECT * FROM statements WHERE id = ?").get(id) as unknown as Statement | undefined,
  run: (propertyId: number, year: number) => db.prepare("SELECT * FROM runs WHERE property_id = ? AND year = ?").get(propertyId, year) as unknown as { summary_json: string; checks_json: string; created_at: string } | undefined,
  statementsForTenant: (tenantId: number) =>
    db.prepare("SELECT * FROM statements WHERE tenant_id = ? ORDER BY year DESC").all(tenantId) as unknown as Statement[],
};
