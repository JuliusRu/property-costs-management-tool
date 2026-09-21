import { randomBytes } from "node:crypto";
import { db } from "./db.js";

export function resetAndSeed() {
  db.exec("DELETE FROM statements; DELETE FROM invoices; DELETE FROM tenants; DELETE FROM units; DELETE FROM properties;");
  seedIfEmpty();
}

export function seedIfEmpty() {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM properties").get() as { n: number }).n;
  if (count > 0) return;

  const prop = db
    .prepare("INSERT INTO properties (name, address, country) VALUES (?, ?, 'DE')")
    .run("Lindenstraße 12", "Lindenstraße 12, 52062 Aachen");
  const pid = Number(prop.lastInsertRowid);

  const insUnit = db.prepare(
    "INSERT INTO units (property_id, label, area_sqm, persons, heating_kwh, water_m3) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insTenant = db.prepare(
    "INSERT INTO tenants (unit_id, name, email, monthly_prepayment_cents, move_in, move_out, portal_token) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  // DG was vacant Jan–Aug 2025: Tom moved in on 1 Sept. That vacancy share must stay with the owner.
  const units = [
    { label: "EG links", area: 58, persons: 1, heat: 4100, water: 38, tenant: "Lena Hoffmann", email: "lena.hoffmann@example.com", prepay: 15000, moveIn: "2022-04-01" },
    { label: "1. OG", area: 74, persons: 2, heat: 6300, water: 71, tenant: "Familie Öztürk", email: "oeztuerk@example.com", prepay: 21000, moveIn: "2019-10-01" },
    { label: "DG", area: 46, persons: 1, heat: 3900, water: 34, tenant: "Tom Becker", email: "tom.becker@example.com", prepay: 12000, moveIn: "2025-09-01" },
  ];
  for (const u of units) {
    const r = insUnit.run(pid, u.label, u.area, u.persons, u.heat, u.water);
    insTenant.run(Number(r.lastInsertRowid), u.tenant, u.email, u.prepay, u.moveIn, null, randomBytes(16).toString("hex"));
  }

  // A couple of invoices already in the system for 2025 so the dashboard isn't empty.
  const insInv = db.prepare(
    `INSERT INTO invoices (property_id, provider, category, description, amount_cents, period_start, period_end, allocation_key, allocable, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'manual')`
  );
  insInv.run(pid, "Stadt Aachen", "property_tax", "Grundsteuer B 2025", 98400, "2025-01-01", "2025-12-31", "area");
  insInv.run(pid, "Provinzial", "insurance", "Wohngebäudeversicherung 2025", 74200, "2025-01-01", "2025-12-31", "area");
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seedIfEmpty();
  console.log("seeded");
}
