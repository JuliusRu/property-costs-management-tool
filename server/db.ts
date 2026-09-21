import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve("data");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "app.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

// Allocation keys according to German BetrKV practice.
export type AllocationKey = "area" | "persons" | "units" | "heating" | "water";

export const CATEGORIES = [
  "property_tax",
  "water_sewage",
  "heating",
  "hot_water",
  "waste",
  "cleaning",
  "garden",
  "lighting",
  "chimney",
  "insurance",
  "caretaker",
  "elevator",
  "cable",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

// Default key per category (landlord can override per invoice).
export const DEFAULT_KEY: Record<Category, AllocationKey> = {
  property_tax: "area",
  water_sewage: "water",
  heating: "heating",
  hot_water: "water",
  waste: "persons",
  cleaning: "area",
  garden: "area",
  lighting: "area",
  chimney: "units",
  insurance: "area",
  caretaker: "area",
  elevator: "area",
  cable: "units",
  other: "area",
};

db.exec(`
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'DE'
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  area_sqm REAL NOT NULL,
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
  portal_token TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  amount_cents INTEGER NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  allocation_key TEXT NOT NULL,
  allocable INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'manual',
  file_name TEXT,
  ai_confidence REAL,
  ai_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  prepaid_cents INTEGER NOT NULL,
  balance_cents INTEGER NOT NULL,
  lines_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  UNIQUE(tenant_id, year)
);
`);

export type Property = { id: number; name: string; address: string; country: string };
export type Unit = {
  id: number; property_id: number; label: string; area_sqm: number;
  persons: number; heating_kwh: number; water_m3: number;
};
export type Tenant = {
  id: number; unit_id: number; name: string; email: string;
  monthly_prepayment_cents: number; portal_token: string;
};
export type Invoice = {
  id: number; property_id: number; provider: string; category: Category;
  description: string | null; amount_cents: number; period_start: string;
  period_end: string; allocation_key: AllocationKey; allocable: number;
  source: string; file_name: string | null; ai_confidence: number | null;
  ai_notes: string | null; created_at: string;
};
export type Statement = {
  id: number; tenant_id: number; year: number; total_cents: number;
  prepaid_cents: number; balance_cents: number; lines_json: string;
  created_at: string; sent_at: string | null;
};

export const q = {
  properties: () => db.prepare("SELECT * FROM properties ORDER BY id").all() as unknown as Property[],
  property: (id: number) => db.prepare("SELECT * FROM properties WHERE id = ?").get(id) as unknown as Property | undefined,
  units: (propertyId: number) => db.prepare("SELECT * FROM units WHERE property_id = ? ORDER BY id").all(propertyId) as unknown as Unit[],
  unit: (id: number) => db.prepare("SELECT * FROM units WHERE id = ?").get(id) as unknown as Unit | undefined,
  tenants: (propertyId: number) =>
    db.prepare("SELECT t.* FROM tenants t JOIN units u ON u.id = t.unit_id WHERE u.property_id = ? ORDER BY t.id").all(propertyId) as unknown as Tenant[],
  tenant: (id: number) => db.prepare("SELECT * FROM tenants WHERE id = ?").get(id) as unknown as Tenant | undefined,
  tenantByToken: (token: string) => db.prepare("SELECT * FROM tenants WHERE portal_token = ?").get(token) as unknown as Tenant | undefined,
  invoices: (propertyId: number, year?: number) =>
    (year
      ? db.prepare("SELECT * FROM invoices WHERE property_id = ? AND substr(period_start,1,4) = ? ORDER BY period_start, id").all(propertyId, String(year))
      : db.prepare("SELECT * FROM invoices WHERE property_id = ? ORDER BY period_start DESC, id DESC").all(propertyId)) as unknown as Invoice[],
  invoice: (id: number) => db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as unknown as Invoice | undefined,
  statements: (propertyId: number, year: number) =>
    db.prepare("SELECT s.* FROM statements s JOIN tenants t ON t.id = s.tenant_id JOIN units u ON u.id = t.unit_id WHERE u.property_id = ? AND s.year = ? ORDER BY u.id").all(propertyId, year) as unknown as Statement[],
  statement: (id: number) => db.prepare("SELECT * FROM statements WHERE id = ?").get(id) as unknown as Statement | undefined,
  statementsForTenant: (tenantId: number) =>
    db.prepare("SELECT * FROM statements WHERE tenant_id = ? ORDER BY year DESC").all(tenantId) as unknown as Statement[],
};
