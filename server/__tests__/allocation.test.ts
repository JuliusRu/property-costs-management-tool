import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatements, splitCents, occupiedDays, daysInYear, co2LandlordShare } from "../allocation.js";
import { DEFAULT_SETTINGS } from "../db.js";
import type { Invoice, Tenant, Unit } from "../db.js";

const units: Unit[] = [
  { id: 1, property_id: 1, label: "A", unit_type: "residential", area_sqm: 58, persons: 1, heating_kwh: 4100, water_m3: 38 },
  { id: 2, property_id: 1, label: "B", unit_type: "residential", area_sqm: 74, persons: 2, heating_kwh: 6300, water_m3: 71 },
  { id: 3, property_id: 1, label: "C", unit_type: "residential", area_sqm: 46, persons: 1, heating_kwh: 3900, water_m3: 34 },
];
const tenant = (id: number, unit_id: number, move_in: string | null = null, move_out: string | null = null): Tenant =>
  ({ id, unit_id, name: `T${id}`, email: "", monthly_prepayment_cents: 10000, move_in, move_out, portal_token: String(id), access_code: "TESTCODE", lease_json: "{}", password_hash: null, registered_at: null });
const inv = (id: number, amount_cents: number, allocation_key: Invoice["allocation_key"], extra: Partial<Invoice> = {}): Invoice =>
  ({ id, property_id: 1, provider: "P", category: "other", description: null, amount_cents, period_start: "2025-01-01", period_end: "2025-12-31",
    allocation_key, allocable: 1, non_allocable_cents: 0, non_allocable_reason: null, co2_cents: 0, energy_kwh: 0, source: "manual", file_name: null, ai_confidence: null, ai_notes: null, created_at: "", ...extra });

test("largest-remainder split always sums to the total", () => {
  for (const total of [1, 2, 100, 98400, 12345]) {
    const parts = splitCents(total, [58, 74, 46]);
    assert.equal(parts.reduce((a, b) => a + b, 0), total);
  }
  assert.deepEqual(splitCents(0, [1, 2]), [0, 0]);
  assert.deepEqual(splitCents(100, [0, 0]), [0, 0]);
});

test("area split: 984,00 € over 58/74/46 m²", () => {
  const { statements, summary } = computeStatements(units, [tenant(1, 1), tenant(2, 2), tenant(3, 3)], [inv(1, 98400, "area")], 2025);
  assert.deepEqual(statements.map((s) => s.total_cents), [32063, 40908, 25429]);
  assert.equal(summary.tenants_cents, 98400);
  assert.equal(summary.owner_vacancy_cents, 0);
  assert.equal(summary.rounding_cents, 0);
  assert.match(statements[0].lines[0].formula, /984,00\s€ × 58 m² \/ 178 m² = 320,63\s€/);
});

test("vacancy stays with the owner, not with other tenants", () => {
  const tenants = [tenant(1, 1), tenant(2, 2), tenant(3, 3, "2025-09-01")];
  const { statements, summary } = computeStatements(units, tenants, [inv(1, 98400, "area")], 2025);
  assert.equal(statements[0].total_cents, 32063); // unchanged for full-year tenants
  assert.equal(statements[1].total_cents, 40908);
  assert.equal(statements[2].lines[0].days_occupied, 122);
  assert.equal(statements[2].total_cents + summary.owner_vacancy_cents, 25429);
  assert.equal(summary.tenants_cents + summary.owner_vacancy_cents, 98400);
  assert.equal(statements[2].prepaid_cents, 4 * 10000);
});

test("two tenants in one unit in sequence: no day counted twice, no cent lost", () => {
  const tenants = [tenant(1, 1), tenant(2, 2), tenant(3, 3, null, "2025-05-14"), tenant(4, 3, "2025-09-01")];
  const { statements, summary, checks } = computeStatements(units, tenants, [inv(1, 98400, "area")], 2025);
  const c = statements.filter((s) => s.unit.id === 3);
  assert.equal(c[0].lines[0].days_occupied, 134);
  assert.equal(c[1].lines[0].days_occupied, 122);
  assert.equal(c[0].total_cents + c[1].total_cents + summary.owner_vacancy_cents, 25429);
  assert.equal(summary.rounding_cents, 0);
  assert.ok(checks.some((k) => k.code === "PARTIAL_VACANCY"));
  assert.ok(!checks.some((k) => k.level === "BLOCKER"));
});

test("overlapping tenancies are a blocker", () => {
  const tenants = [tenant(1, 1), tenant(2, 2), tenant(3, 3, null, "2025-06-30"), tenant(4, 3, "2025-06-01")];
  const { checks } = computeStatements(units, tenants, [inv(1, 98400, "area")], 2025);
  assert.ok(checks.some((k) => k.code === "OVERLAP" && k.level === "BLOCKER"));
});

test("consumption keys are not time-prorated", () => {
  const tenants = [tenant(1, 1), tenant(2, 2), tenant(3, 3, "2025-09-01")];
  const { statements, summary } = computeStatements(units, tenants, [inv(1, 94351, "water")], 2025);
  assert.equal(statements[2].lines[0].days_occupied, 365);
  assert.equal(summary.owner_vacancy_cents, 0);
  assert.equal(summary.tenants_cents, 94351);
});

test("non-allocable invoices are excluded and reported", () => {
  const { summary, checks } = computeStatements(units, [tenant(1, 1), tenant(2, 2), tenant(3, 3)], [inv(1, 10000, "area"), inv(2, 5000, "area", { allocable: 0 })], 2025);
  assert.equal(summary.non_allocable_cents, 5000);
  assert.equal(summary.allocable_cents, 10000);
  assert.ok(checks.some((k) => k.code === "NON_ALLOCABLE"));
});

test("duplicate invoices are flagged", () => {
  const { checks } = computeStatements(units, [tenant(1, 1)], [inv(1, 10000, "area"), inv(2, 10000, "area")], 2025);
  assert.ok(checks.some((k) => k.code === "DUPLICATE"));
});

test("invoice crossing the year boundary is pro-rated by months", () => {
  const { summary } = computeStatements(units, [tenant(1, 1), tenant(2, 2), tenant(3, 3)], [inv(1, 120000, "area", { period_start: "2024-07-01", period_end: "2025-06-30" })], 2025);
  assert.equal(summary.allocable_cents, 60000);
});

test("leap year has 366 days", () => {
  assert.equal(daysInYear(2024), 366);
  assert.equal(daysInYear(2025), 365);
  assert.equal(occupiedDays({ move_in: "2024-02-01", move_out: null }, 2024), 335);
});

test("heating: 30 % basic by area, 70 % consumption by kWh; only the basic part follows occupancy", () => {
  const tenants = [tenant(1, 1), tenant(2, 2), tenant(3, 3, "2025-09-01")];
  const { statements, summary } = computeStatements(units, tenants, [inv(1, 215471, "heating")], 2025);
  assert.equal(summary.tenants_cents + summary.owner_vacancy_cents, 215471);
  assert.match(statements[0].lines[0].formula, /30 % basic costs: 646,41\s€ × 58 m² \/ 178 m²/);
  assert.match(statements[0].lines[0].formula, /70 % consumption: 1\.508,30\s€ × 4100 kWh \/ 14300 kWh/);
  // vacancy only on the basic part: 30 % × 46/178 × 243/365 days
  const basicC = Math.round(64641 * 46 / 178);
  assert.ok(summary.owner_vacancy_cents > 0 && summary.owner_vacancy_cents < basicC);
});

test("partially non-allocable invoice: only the allocable part is distributed", () => {
  const { summary, statements } = computeStatements(units, [tenant(1, 1), tenant(2, 2), tenant(3, 3)], [inv(1, 193554, "area", { non_allocable_cents: 18650 })], 2025);
  assert.equal(summary.non_allocable_cents, 18650);
  assert.equal(summary.allocable_cents, 174904);
  assert.equal(summary.tenants_cents, 174904);
  assert.match(statements[0].lines[0].formula, /186,50\s€ not allocable excluded/);
});

test("CO2KostAufG stages", () => {
  assert.equal(co2LandlordShare(11.9), 0);
  assert.equal(co2LandlordShare(12), 0.1);
  assert.equal(co2LandlordShare(16.1), 0.1);
  assert.equal(co2LandlordShare(36.9), 0.5);
  assert.equal(co2LandlordShare(60), 0.95);
});

test("CO₂ landlord share is excluded from the heating allocation", () => {
  const all = [tenant(1, 1), tenant(2, 2), tenant(3, 3)];
  // 14300 kWh gas × 0.201 = 2874 kg / 178 m² = 16.1 kg/m² → landlord 10 % of 158,07 € = 15,81 €
  const { summary, checks } = computeStatements(units, all, [inv(1, 222758, "heating", { category: "heating", co2_cents: 15807, energy_kwh: 14300 })], 2025, { ...DEFAULT_SETTINGS, heating_type: "gas" });
  assert.equal(summary.co2_landlord_cents, 1581);
  assert.equal(summary.non_allocable_cents, 1581);
  assert.equal(summary.allocable_cents, 222758 - 1581);
  assert.ok(checks.some((c) => c.code === "CO2_SPLIT"));
});

test("decentral heating: heating invoices are not allocated", () => {
  const { summary, checks } = computeStatements(units, [tenant(1, 1)], [inv(1, 100000, "heating", { category: "heating" })], 2025, { ...DEFAULT_SETTINGS, heating_type: "decentral" });
  assert.equal(summary.allocable_cents, 0);
  assert.ok(checks.some((c) => c.code === "DECENTRAL_HEATING"));
});

test("cable/TV after 1 July 2024 is not allocable", () => {
  const { summary, checks } = computeStatements(units, [tenant(1, 1)], [inv(1, 24000, "units", { category: "cable" })], 2025);
  assert.equal(summary.allocable_cents, 0);
  assert.ok(checks.some((c) => c.code === "CABLE_NOT_ALLOCABLE"));
});

test("consumption share is configurable within 50–70 % and § 11 exemption allocates by area", () => {
  const all = [tenant(1, 1), tenant(2, 2), tenant(3, 3)];
  const r50 = computeStatements(units, all, [inv(1, 100000, "heating")], 2025, { ...DEFAULT_SETTINGS, consumption_share: 0.5 });
  assert.match(r50.statements[0].lines[0].formula, /50 % basic costs/);
  const ex = computeStatements(units, all, [inv(1, 100000, "heating")], 2025, { ...DEFAULT_SETTINGS, heizkv_exempt: true });
  assert.match(ex.statements[0].lines[0].formula, /§ 11 HeizkostenV exempt/);
  assert.equal(ex.statements[0].total_cents, Math.round(100000 * 58 / 178));
});

test("garages take no part in persons- or consumption-based costs", () => {
  const withGarage: Unit[] = [...units, { id: 9, property_id: 1, label: "G", unit_type: "garage", area_sqm: 15, persons: 0, heating_kwh: 0, water_m3: 0 }];
  const all = [tenant(1, 1), tenant(2, 2), tenant(3, 3), tenant(9, 9)];
  const waste = computeStatements(withGarage, all, [inv(1, 40000, "persons", { category: "waste" })], 2025);
  assert.equal(waste.statements[3].total_cents, 0);
  const tax = computeStatements(withGarage, all, [inv(1, 19300, "area", { category: "property_tax" })], 2025);
  assert.equal(tax.statements[3].total_cents, Math.round(19300 * 15 / 193));
});

test("deadline check reflects § 556 (3)", () => {
  const late = computeStatements(units, [tenant(1, 1)], [inv(1, 1000, "area")], 2023, DEFAULT_SETTINGS, new Date("2025-03-01"));
  assert.ok(late.checks.some((c) => c.code === "DEADLINE_PASSED"));
  const soon = computeStatements(units, [tenant(1, 1)], [inv(1, 1000, "area")], 2025, DEFAULT_SETTINGS, new Date("2026-11-15"));
  assert.ok(soon.checks.some((c) => c.code === "DEADLINE_SOON"));
});

test("suggested prepayment annualises a partial year (§ 560 (4))", () => {
  const { statements } = computeStatements(units, [tenant(1, 1), tenant(2, 2), tenant(3, 3, "2025-09-01")], [inv(1, 98400, "area")], 2025);
  const c = statements[2];
  assert.equal(c.suggested_prepayment_cents, Math.round((c.total_cents * 365) / 122 / 12));
});

test("lease key override: tenant is charged by the lease key, landlord bears the difference", () => {
  const all = [tenant(1, 1), tenant(2, 2), tenant(3, 3)];
  all[1] = { ...all[1], lease_json: JSON.stringify({ key_overrides: { waste: "area" }, confirmed: true }) };
  const { statements, summary } = computeStatements(units, all, [inv(1, 55520, "persons", { category: "waste" })], 2025);
  // default: B has 2 of 4 persons = 277,60 €; lease: 74/178 m² = 230,82 €
  assert.equal(statements[1].total_cents, Math.round(55520 * 74 / 178));
  assert.equal(summary.owner_lease_diff_cents, 27760 - Math.round(55520 * 74 / 178));
  assert.equal(summary.rounding_cents, 0);
  assert.match(statements[1].lines[0].formula, /building default would be/);
});

test("flat rate (Pauschale) tenants get no statement; unconfirmed AI lease rules block sending", () => {
  const all = [tenant(1, 1), tenant(2, 2), tenant(3, 3)];
  all[2] = { ...all[2], lease_json: JSON.stringify({ prepayment_type: "pauschale", confirmed: false }) };
  const { statements, summary, checks } = computeStatements(units, all, [inv(1, 98400, "area")], 2025);
  assert.equal(statements.length, 2);
  assert.equal(summary.owner_lease_diff_cents, 25429);
  assert.equal(summary.tenants_cents + summary.owner_lease_diff_cents, 98400);
  assert.ok(checks.some((c) => c.code === "LEASE_UNCONFIRMED" && c.level === "BLOCKER"));
});
