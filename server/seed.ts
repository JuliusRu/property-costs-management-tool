import type { Store } from "./store.js";
import type { Property, Unit } from "./db.js";

/**
 * Sample buildings, loaded on request into the CURRENT user's organization ("Load sample buildings").
 * Tenants get random registration codes and no password — demo logins must not be shared
 * across accounts, or one user's demo tenant could sign into another user's portal.
 */
export async function loadDemo(st: Store) {
  await seedAachen(st);
  await seedMunich(st);
}

// Lindenstraße 12, Aachen: DG vacant Jan–Aug 2025 (Tom moved in on 1 Sept) — that vacancy share stays with the owner.
async function seedAachen(st: Store) {
  const p = await st.insert<Property>("properties", {
    name: "Lindenstraße 12", address: "Lindenstraße 12, 52062 Aachen",
    settings_json: { heating_type: "gas", consumption_share: 0.7, hot_water_central: true, heizkv_exempt: false, heated_area_sqm: null },
  });
  const units = [
    { label: "EG links", area: 58, persons: 1, heat: 4100, water: 38, tenant: "Lena Hoffmann", email: "lena.hoffmann@example.com", prepay: 19000, moveIn: "2022-04-01" },
    { label: "1. OG", area: 74, persons: 2, heat: 6300, water: 71, tenant: "Familie Öztürk", email: "oeztuerk@example.com", prepay: 21000, moveIn: "2019-10-01" },
    { label: "DG", area: 46, persons: 1, heat: 3900, water: 34, tenant: "Tom Becker", email: "tom.becker@example.com", prepay: 25000, moveIn: "2025-09-01" },
  ];
  for (const u of units) {
    const unit = await st.insert<Unit>("units", { property_id: p.id, label: u.label, area_sqm: u.area, persons: u.persons, heating_kwh: u.heat, water_m3: u.water });
    await st.insert("tenants", { unit_id: unit.id, name: u.tenant, email: u.email, monthly_prepayment_cents: u.prepay, move_in: u.moveIn });
  }
  await st.insertMany("invoices", [
    { property_id: p.id, provider: "Stadt Aachen", category: "property_tax", description: "Grundsteuer B 2025", amount_cents: 98400, period_start: "2025-01-01", period_end: "2025-12-31", allocation_key: "area" },
    { property_id: p.id, provider: "Provinzial", category: "insurance", description: "Wohngebäudeversicherung 2025", amount_cents: 74200, period_start: "2025-01-01", period_end: "2025-12-31", allocation_key: "area" },
  ]);
}

// Musterweg 7, Munich — modelled on a real statement (names changed): five units incl. a restaurant,
// allocation by co-ownership shares (MEA), waste for apartments only, water metered per unit, a cable credit.
async function seedMunich(st: Store) {
  const p = await st.insert<Property>("properties", {
    name: "Musterweg 7", address: "Musterweg 7, 80331 München",
    settings_json: { heating_type: "decentral", consumption_share: 0.7, hot_water_central: false, heizkv_exempt: false, heated_area_sqm: null },
  });
  const units = [
    { label: "1-Wohnung", type: "residential", area: 70, mea: 110.5, persons: 2, tenant: "Jonas Brandt", email: "jonas.brandt@example.com", prepay: 16000, moveIn: "2018-06-01" },
    { label: "2-Wohnung", type: "residential", area: 68, mea: 108.25, persons: 2, tenant: "Miriam Kaya", email: "miriam.kaya@example.com", prepay: 15500, moveIn: "2021-03-01" },
    { label: "3-Wohnung", type: "residential", area: 67, mea: 107.5, persons: 1, tenant: "Paul Richter", email: "paul.richter@example.com", prepay: 14000, moveIn: "2023-11-01" },
    { label: "5-Wohnung", type: "residential", area: 64, mea: 101.72, persons: 1, tenant: "Nora Weber", email: "nora.weber@example.com", prepay: 15000, moveIn: "2020-09-01" },
    { label: "Gaststätte EG", type: "commercial", area: 120, mea: 98, persons: 0, tenant: "Trattoria Da Luca GmbH", email: "info@daluca.example.com", prepay: 32000, moveIn: "2016-01-01" },
  ];
  const ids: number[] = [];
  for (const u of units) {
    const unit = await st.insert<Unit>("units", { property_id: p.id, label: u.label, unit_type: u.type, area_sqm: u.area, mea: u.mea, persons: u.persons });
    ids.push(unit.id);
    await st.insert("tenants", { unit_id: unit.id, name: u.tenant, email: u.email, monthly_prepayment_cents: u.prepay, move_in: u.moveIn });
  }
  const year = { period_start: "2025-01-01", period_end: "2025-12-31" };
  const B = (provider: string, category: string, description: string, amount_cents: number, pool = "all") =>
    ({ property_id: p.id, provider, category, description, amount_cents, allocation_key: "mea", pool, ...year });
  const rows: Record<string, unknown>[] = [
    B("Hausmeisterdienst Huber", "caretaker", "Hausmeister 2025", 502656),
    B("Allianz", "insurance", "Gebäudeversicherung 2025", 131977),
    B("Allianz", "insurance", "Wohngebäude-Brandversicherung 2025", 51325),
    B("Allianz", "insurance", "Haus- und Grundbesitzerhaftpflicht 2025", 60702),
    B("AWM München", "waste", "Müllabfuhr 2025 (Wohnungen; Gaststätte hat eigenen Vertrag)", 68445, "residential"),
    B("Landeshauptstadt München", "street_cleaning", "Straßenreinigung 2025", 58124),
    B("SWM", "rainwater", "Niederschlagswasser 2025", 35046),
    B("SWM", "lighting", "Allgemeinstrom 2025", 41930),
    B("Kaminkehrer Meier", "chimney", "Schornsteinfeger 2025", 167072),
    B("Landeshauptstadt München", "property_tax", "Grundsteuer B 2025", 71260),
    { ...B("Vodafone", "cable", "Gutschrift Kabelanschluss (Vertragsende 2024)", -3595), allocation_key: "units" },
  ];
  // Water is metered per unit and billed directly.
  const water: [number, number, number][] = [[0, 21870, 21930], [1, 20120, 20180], [2, 11640, 11680], [3, 19243, 19295], [4, 78400, 78600]];
  for (const [i, fresh, sewage] of water) {
    rows.push({ property_id: p.id, unit_id: ids[i], provider: "SWM", category: "water_sewage", description: `Frischwasser ${units[i].label} 2025`, amount_cents: fresh, allocation_key: "water", ...year });
    rows.push({ property_id: p.id, unit_id: ids[i], provider: "SWM", category: "water_sewage", description: `Abwasser ${units[i].label} 2025`, amount_cents: sewage, allocation_key: "water", ...year });
  }
  await st.insertMany("invoices", rows);
}
