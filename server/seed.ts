import { randomBytes } from "node:crypto";
import { db, newAccessCode } from "./db.js";
import { hashPassword } from "./auth.js";

export function resetAndSeed() {
  db.exec("DELETE FROM statements; DELETE FROM runs; DELETE FROM invoices; DELETE FROM tenants; DELETE FROM units; DELETE FROM properties; DELETE FROM sqlite_sequence;");
  seedIfEmpty();
}

export function seedIfEmpty() {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM properties").get() as { n: number }).n;
  if (count > 0) {
    // Demo databases created before the Munich building existed: add it once, without touching anything else.
    const has = (name: string) => !!db.prepare("SELECT 1 FROM properties WHERE name = ?").get(name);
    if (has("Lindenstraße 12") && !has("Musterweg 7")) seedMunich();
    return;
  }

  const prop = db
    .prepare("INSERT INTO properties (name, address, country, settings_json) VALUES (?, ?, 'DE', ?)")
    .run("Lindenstraße 12", "Lindenstraße 12, 52062 Aachen", JSON.stringify({ heating_type: "gas", consumption_share: 0.7, hot_water_central: true, heizkv_exempt: false, heated_area_sqm: null }));
  const pid = Number(prop.lastInsertRowid);

  const insUnit = db.prepare(
    "INSERT INTO units (property_id, label, area_sqm, persons, heating_kwh, water_m3) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const insTenant = db.prepare(
    "INSERT INTO tenants (unit_id, name, email, monthly_prepayment_cents, move_in, move_out, portal_token, access_code, password_hash, registered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  // DG was vacant Jan–Aug 2025: Tom moved in on 1 Sept. That vacancy share must stay with the owner.
  const units = [
    { label: "EG links", area: 58, persons: 1, heat: 4100, water: 38, tenant: "Lena Hoffmann", email: "lena.hoffmann@example.com", prepay: 19000, moveIn: "2022-04-01", code: "LENA2025", password: "demo1234" },
    { label: "1. OG", area: 74, persons: 2, heat: 6300, water: 71, tenant: "Familie Öztürk", email: "oeztuerk@example.com", prepay: 21000, moveIn: "2019-10-01", code: "OEZT2025", password: null },
    { label: "DG", area: 46, persons: 1, heat: 3900, water: 34, tenant: "Tom Becker", email: "tom.becker@example.com", prepay: 25000, moveIn: "2025-09-01", code: newAccessCode(), password: null },
  ];
  for (const u of units) {
    const r = insUnit.run(pid, u.label, u.area, u.persons, u.heat, u.water);
    // Lena is already registered (demo login); the others still have to register with their code.
    insTenant.run(Number(r.lastInsertRowid), u.tenant, u.email, u.prepay, u.moveIn, null, randomBytes(16).toString("hex"), u.code,
      u.password ? hashPassword(u.password) : null, u.password ? "2026-01-15 10:00:00" : null);
  }

  // A couple of invoices already in the system for 2025 so the dashboard isn't empty.
  const insInv = db.prepare(
    `INSERT INTO invoices (property_id, provider, category, description, amount_cents, period_start, period_end, allocation_key, allocable, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'manual')`
  );
  insInv.run(pid, "Stadt Aachen", "property_tax", "Grundsteuer B 2025", 98400, "2025-01-01", "2025-12-31", "area");
  insInv.run(pid, "Provinzial", "insurance", "Wohngebäudeversicherung 2025", 74200, "2025-01-01", "2025-12-31", "area");

  seedMunich();
}

// Second demo building, modelled on a real Munich statement (names changed): five units incl. a restaurant,
// allocation by co-ownership shares (MEA), waste for apartments only, water metered per unit, a cable credit.
function seedMunich() {
  const prop = db.prepare("INSERT INTO properties (name, address, country, settings_json) VALUES (?, ?, 'DE', ?)")
    .run("Musterweg 7", "Musterweg 7, 80331 München", JSON.stringify({ heating_type: "decentral", consumption_share: 0.7, hot_water_central: false, heizkv_exempt: false, heated_area_sqm: null }));
  const pid = Number(prop.lastInsertRowid);
  const insUnit = db.prepare("INSERT INTO units (property_id, label, unit_type, area_sqm, mea, persons, heating_kwh, water_m3) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const insTenant = db.prepare("INSERT INTO tenants (unit_id, name, email, monthly_prepayment_cents, move_in, move_out, portal_token, access_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const units = [
    { label: "1-Wohnung", type: "residential", area: 70, mea: 110.5, persons: 2, tenant: "Jonas Brandt", email: "jonas.brandt@example.com", prepay: 16000, moveIn: "2018-06-01" },
    { label: "2-Wohnung", type: "residential", area: 68, mea: 108.25, persons: 2, tenant: "Miriam Kaya", email: "miriam.kaya@example.com", prepay: 15500, moveIn: "2021-03-01" },
    { label: "3-Wohnung", type: "residential", area: 67, mea: 107.5, persons: 1, tenant: "Paul Richter", email: "paul.richter@example.com", prepay: 14000, moveIn: "2023-11-01" },
    { label: "5-Wohnung", type: "residential", area: 64, mea: 101.72, persons: 1, tenant: "Nora Weber", email: "nora.weber@example.com", prepay: 15000, moveIn: "2020-09-01" },
    { label: "Gaststätte EG", type: "commercial", area: 120, mea: 98, persons: 0, tenant: "Trattoria Da Luca GmbH", email: "info@daluca.example.com", prepay: 32000, moveIn: "2016-01-01" },
  ];
  const ids: number[] = [];
  for (const u of units) {
    const r = insUnit.run(pid, u.label, u.type, u.area, u.mea, u.persons, 0, 0);
    ids.push(Number(r.lastInsertRowid));
    insTenant.run(Number(r.lastInsertRowid), u.tenant, u.email, u.prepay, u.moveIn, null, randomBytes(16).toString("hex"), newAccessCode());
  }
  const ins = db.prepare(`INSERT INTO invoices (property_id, unit_id, provider, category, description, amount_cents, period_start, period_end, allocation_key, pool, allocable, source)
    VALUES (?, ?, ?, ?, ?, ?, '2025-01-01', '2025-12-31', ?, ?, 1, 'manual')`);
  const B = (provider: string, cat: string, desc: string, cents: number, pool = "all") => ins.run(pid, null, provider, cat, desc, cents, "mea", pool);
  B("Hausmeisterdienst Huber", "caretaker", "Hausmeister 2025", 502656);
  B("Allianz", "insurance", "Gebäudeversicherung 2025", 131977);
  B("Allianz", "insurance", "Wohngebäude-Brandversicherung 2025", 51325);
  B("Allianz", "insurance", "Haus- und Grundbesitzerhaftpflicht 2025", 60702);
  B("AWM München", "waste", "Müllabfuhr 2025 (Wohnungen; Gaststätte hat eigenen Vertrag)", 68445, "residential");
  B("Landeshauptstadt München", "street_cleaning", "Straßenreinigung 2025", 58124);
  B("SWM", "rainwater", "Niederschlagswasser 2025", 35046);
  B("SWM", "lighting", "Allgemeinstrom 2025", 41930);
  B("Kaminkehrer Meier", "chimney", "Schornsteinfeger 2025", 167072);
  B("Landeshauptstadt München", "property_tax", "Grundsteuer B 2025", 71260);
  ins.run(pid, null, "Vodafone", "cable", "Gutschrift Kabelanschluss (Vertragsende 2024)", -3595, "units", "all");
  // Water is metered per unit and billed directly.
  const water: [number, number, number][] = [[0, 21870, 21930], [1, 20120, 20180], [2, 11640, 11680], [3, 19243, 19295], [4, 78400, 78600]];
  for (const [i, fresh, sewage] of water) {
    ins.run(pid, ids[i], "SWM", "water_sewage", `Frischwasser ${units[i].label} 2025`, fresh, "water", "all");
    ins.run(pid, ids[i], "SWM", "water_sewage", `Abwasser ${units[i].label} 2025`, sewage, "water", "all");
  }
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seedIfEmpty();
  console.log("seeded");
}
