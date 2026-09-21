import { CO2_FACTOR, DEFAULT_SETTINGS, leaseOf, type AllocationKey, type Category, type Invoice, type PropertySettings, type Tenant, type Unit } from "./db.js";

export type StatementLine = {
  invoice_id: number;
  provider: string;
  category: string;
  description: string | null;
  allocation_key: AllocationKey;
  total_cents: number;      // building total for the year (pro-rated if the invoice period crosses years)
  basis_unit: number;       // kept for compatibility; the formula string carries the numbers
  basis_total: number;
  unit_share_cents: number;
  days_occupied: number;    // days the tenant occupied the unit in the year
  days_in_year: number;
  share_cents: number;      // what the tenant actually owes
  formula: string;          // human-readable calculation with the real numbers
};

export type TenantStatement = {
  tenant: Tenant;
  unit: Unit;
  year: number;
  lines: StatementLine[];
  total_cents: number;
  prepaid_cents: number;
  months_occupied: number;
  balance_cents: number; // positive = tenant owes, negative = refund
  suggested_prepayment_cents: number; // § 560 (4) BGB: new monthly prepayment = this year's costs / 12
};

export type BuildingSummary = {
  year: number;
  invoiced_cents: number;        // all invoices of the year, allocable or not
  non_allocable_cents: number;   // excluded (§ 2 BetrKV)
  allocable_cents: number;
  tenants_cents: number;         // allocated to tenants
  owner_vacancy_cents: number;   // stays with the owner because units were vacant
  rounding_cents: number;        // must be 0 — invariant
  co2_landlord_cents: number;    // CO2KostAufG share the landlord carries (included in non_allocable)
  owner_lease_diff_cents: number; // what the landlord bears because leases deviate from the building default (+ = landlord loses)
  legal_basis: string;           // which rule set the run was computed with
};

export type Check = { level: "BLOCKER" | "WARNING" | "INFO"; code: string; message: string; hint?: string };

export const RULES_VERSION = "DE 2025-01 · § 556 BGB, BetrKV, HeizkostenV § 7–9, CO2KostAufG § 7, TKG § 72 (cable from 2024-07-01)";

/** CO2KostAufG § 7 Anlage: landlord's share of CO₂ costs by the building's emissions per m² and year. */
export function co2LandlordShare(kgPerSqm: number): number {
  const stages: [number, number][] = [[12, 0], [17, 0.1], [22, 0.2], [27, 0.3], [32, 0.4], [37, 0.5], [42, 0.6], [47, 0.7], [52, 0.8]];
  for (const [limit, share] of stages) if (kgPerSqm < limit) return share;
  return 0.95;
}

/** Which units take part in a cost category. Garages have no persons, water or heating; commercial units take part in everything (Vorwegabzug is a manual rule for now). */
export function participates(unit: Unit, category: string): boolean {
  if (unit.unit_type === "garage") return ["property_tax", "insurance", "rainwater", "street_cleaning", "lighting"].includes(category);
  return true;
}

const KEY_UNIT: Record<AllocationKey, string> = { area: "m²", persons: "persons", units: "unit", heating: "kWh", water: "m³" };
// Consumption-based keys are already tenant-specific — they are not time-prorated.
const TIME_PRORATED: Record<AllocationKey, boolean> = { area: true, persons: true, units: true, heating: false, water: false };

export function basis(unit: Unit, key: AllocationKey): number {
  switch (key) {
    case "area": return unit.area_sqm;
    case "persons": return unit.persons;
    case "units": return 1;
    case "heating": return unit.heating_kwh;
    case "water": return unit.water_m3;
  }
}

const eur = (c: number) => (c / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const DAY = 86_400_000;
const utc = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));

export function daysInYear(year: number) { return (utc(`${year + 1}-01-01`) - utc(`${year}-01-01`)) / DAY; }

/** Inclusive days a tenant occupied a unit within the year (both boundaries inclusive, so no day is counted twice or lost). */
export function occupiedDays(t: Pick<Tenant, "move_in" | "move_out">, year: number): number {
  const ys = utc(`${year}-01-01`), ye = utc(`${year}-12-31`);
  const from = t.move_in ? Math.max(utc(t.move_in), ys) : ys;
  const to = t.move_out ? Math.min(utc(t.move_out), ye) : ye;
  return to < from ? 0 : (to - from) / DAY + 1;
}

/** Full months a tenant occupied the unit in the year — used for prepayments (monthly amount × months). */
export function occupiedMonths(t: Pick<Tenant, "move_in" | "move_out">, year: number): number {
  const s = t.move_in && t.move_in > `${year}-01-01` ? Number(t.move_in.slice(5, 7)) : 1;
  const e = t.move_out && t.move_out < `${year}-12-31` ? Number(t.move_out.slice(5, 7)) : 12;
  return Math.max(0, e - s + 1);
}

function monthsOverlap(periodStart: string, periodEnd: string, year: number): number {
  const s = new Date(periodStart), e = new Date(periodEnd);
  const ys = new Date(`${year}-01-01`), ye = new Date(`${year}-12-31`);
  const from = s > ys ? s : ys, to = e < ye ? e : ye;
  if (to < from) return 0;
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1;
}
function periodMonths(periodStart: string, periodEnd: string): number {
  const s = new Date(periodStart), e = new Date(periodEnd);
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
}

/** Largest-remainder rounding: integer parts sum exactly to `total`. */
export function splitCents(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) { if (rest <= 0) break; out[i]++; rest--; }
  return out;
}

/**
 * Deterministic allocation:
 *   invoice total (pro-rated to the year) → split across units by key (largest remainder)
 *   → unit share split across the unit's occupancy: tenant days vs. vacant days.
 * Vacancy never lands on other tenants; it is reported as the owner's share.
 */
export function computeStatements(units: Unit[], tenants: Tenant[], invoices: Invoice[], year: number, settings: PropertySettings = DEFAULT_SETTINGS, today: Date = new Date()): { statements: TenantStatement[]; summary: BuildingSummary; checks: Check[] } {
  const diy = daysInYear(year);
  const perTenant = new Map<number, StatementLine[]>();
  for (const t of tenants) perTenant.set(t.id, []);
  let allocable = 0, nonAllocable = 0, tenantsTotal = 0, ownerVacancy = 0, invoiced = 0, co2Landlord = 0, leaseDiff = 0;
  const checks: Check[] = [];
  const leases = new Map(tenants.map((t) => [t.id, leaseOf(t)]));
  // Tenants on a flat rate (Pauschale) get no statement at all; their unit's share stays with the landlord.
  const flatRate = new Set(tenants.filter((t) => leases.get(t.id)!.prepayment_type === "pauschale").map((t) => t.id));
  for (const t of tenants) if (flatRate.has(t.id)) checks.push({ level: "INFO", code: "PAUSCHALE", message: `${t.name}: the lease agrees a flat rate (Betriebskostenpauschale) — no statement is issued and no additional payment can be claimed (§ 556 (2) BGB).` });

  // HeizkostenV § 7: heating costs are split into a basic part (by area) and a consumption part (by metered kWh), 50–70 % consumption.
  const share = Math.min(0.7, Math.max(0.5, settings.consumption_share || 0.7));
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const heatingCentral = settings.heating_type !== "decentral";
  const heatedArea = settings.heated_area_sqm || units.filter((u) => u.unit_type !== "garage").reduce((s, u) => s + u.area_sqm, 0);

  type Component = { label: string; amount: number; key: AllocationKey; prorated: boolean };
  const componentsOf = (inv: Invoice, allocableAmount: number): Component[] => {
    if (inv.allocation_key === "heating" && !settings.heizkv_exempt) {
      const consumption = Math.round(allocableAmount * share);
      return [
        { label: `${pct(1 - share)} basic costs`, amount: allocableAmount - consumption, key: "area", prorated: true },
        { label: `${pct(share)} consumption`, amount: consumption, key: "heating", prorated: false },
      ];
    }
    if (inv.allocation_key === "heating") return [{ label: "§ 11 HeizkostenV exempt, by area", amount: allocableAmount, key: "area", prorated: true }];
    return [{ label: "", amount: allocableAmount, key: inv.allocation_key, prorated: TIME_PRORATED[inv.allocation_key] }];
  };

  for (const inv of invoices) {
    const months = monthsOverlap(inv.period_start, inv.period_end, year);
    if (months === 0) continue;
    const pm = periodMonths(inv.period_start, inv.period_end);
    const yearAmount = pm === months ? inv.amount_cents : Math.round((inv.amount_cents * months) / pm);
    invoiced += yearAmount;
    if (pm !== months) checks.push({ level: "INFO", code: "PRORATED", message: `${inv.provider} (${inv.description ?? inv.category}) covers ${pm} months; ${months} of them fall into ${year} → ${eur(yearAmount)} of ${eur(inv.amount_cents)} used.` });
    if (!inv.allocable) { nonAllocable += yearAmount; continue; }
    let excluded = Math.min(yearAmount, Math.round(((inv.non_allocable_cents ?? 0) * months) / pm));

    // TKG § 72: cable/antenna costs are no longer allocable for periods from 1 July 2024.
    if (inv.category === "cable" && inv.period_end >= "2024-07-01") {
      if (inv.period_start >= "2024-07-01") {
        excluded = yearAmount;
        checks.push({ level: "WARNING", code: "CABLE_NOT_ALLOCABLE", message: `${inv.provider}: cable/TV costs are not allocable since 1 July 2024 (end of the Nebenkostenprivileg) — ${eur(yearAmount)} booked to you.`, hint: "Tenants contract their own TV/internet. Remove the invoice or keep it as owner cost." });
      } else {
        checks.push({ level: "WARNING", code: "CABLE_PARTIAL", message: `${inv.provider}: cable/TV costs are only allocable up to 30 June 2024; split this invoice by period.` });
      }
    }
    // Decentral heating (gas/electric per flat): tenants have their own supply contracts — nothing to allocate.
    if ((inv.category === "heating" || inv.category === "hot_water") && !heatingCentral) {
      excluded = yearAmount;
      checks.push({ level: "WARNING", code: "DECENTRAL_HEATING", message: `${inv.provider}: the building is set to decentral heating, so ${eur(yearAmount)} of ${inv.category === "heating" ? "heating" : "hot water"} costs cannot be allocated — tenants pay their own supplier.`, hint: "If this is a central system after all, change the heating type in the building settings." });
    }
    // CO2KostAufG: split the CO₂ price component between landlord and tenants by the building's emissions per m².
    if (inv.category === "heating" && heatingCentral && inv.co2_cents > 0) {
      const factor = CO2_FACTOR[settings.heating_type];
      if (inv.energy_kwh > 0 && factor > 0 && heatedArea > 0) {
        const kg = inv.energy_kwh * factor;
        const perSqm = kg / heatedArea;
        const landlordShare = co2LandlordShare(perSqm);
        const landlordCents = Math.round(inv.co2_cents * landlordShare);
        excluded = Math.min(yearAmount, excluded + landlordCents);
        co2Landlord += landlordCents;
        checks.push({ level: "INFO", code: "CO2_SPLIT", message: `CO₂ costs ${eur(inv.co2_cents)} (${inv.provider}): ${Math.round(kg)} kg CO₂ / ${heatedArea} m² = ${perSqm.toFixed(1)} kg/m² → landlord share ${pct(landlordShare)} = ${eur(landlordCents)} (CO2KostAufG § 7).` });
      } else if (factor === 0) {
        checks.push({ level: "INFO", code: "CO2_NA", message: `${inv.provider}: no CO₂ split needed for ${settings.heating_type.replace("_", " ")}.` });
      } else {
        checks.push({ level: "WARNING", code: "CO2_MISSING_KWH", message: `${inv.provider}: CO₂ costs of ${eur(inv.co2_cents)} found, but no kWh on the invoice — the CO2KostAufG split cannot be computed.`, hint: "Enter the delivered kWh on the invoice." });
      }
    }
    nonAllocable += excluded;
    const allocableAmount = yearAmount - excluded;
    allocable += allocableAmount;

    const comps = componentsOf(inv, allocableAmount);
    const acc = new Map<number, { share: number; days: number; parts: string[] }>();
    let ok = true;
    for (const c of comps) {
      const bases = units.map((u) => (participates(u, inv.category) ? basis(u, c.key) : 0));
      const basisTotal = bases.reduce((s, b) => s + b, 0);
      if (basisTotal === 0) { checks.push({ level: "BLOCKER", code: "NO_BASIS", message: `${inv.provider}: allocation key "${c.key}" has no data on any unit.`, hint: "Enter the values on the units or choose a different key." }); ok = false; break; }
      const unitShares = splitCents(c.amount, bases);
      units.forEach((u, i) => {
        const unitShare = unitShares[i];
        const occupants = tenants.filter((t) => t.unit_id === u.id);
        const dayWeights = occupants.map((t) => (c.prorated ? occupiedDays(t, year) : diy));
        const occupiedSum = dayWeights.reduce((s, d) => s + d, 0);
        const weights = c.prorated ? [...dayWeights, Math.max(0, diy - occupiedSum)] : [...dayWeights, 0];
        const parts = splitCents(unitShare, weights);
        ownerVacancy += parts[parts.length - 1];
        occupants.forEach((t, j) => {
          const days = c.prorated ? dayWeights[j] : diy;
          let share = parts[j];
          const lease = leases.get(t.id)!;
          const prefix = c.label ? `${c.label}: ` : "";
          let f = `${prefix}${eur(c.amount)} × ${bases[i]} ${KEY_UNIT[c.key]} / ${basisTotal} ${KEY_UNIT[c.key]} = ${eur(unitShare)}`;
          if (c.prorated && days !== diy) f += ` × ${days}/${diy} days = ${eur(share)}`;
          // Lease rules rank above the building default. Whatever the lease shifts is the landlord's gain or loss.
          const cat = inv.category as Category;
          if (flatRate.has(t.id) || lease.excluded_categories.includes(cat)) {
            leaseDiff += share;
            f = flatRate.has(t.id) ? `flat rate — not charged (${eur(share)} stays with the landlord)` : `not agreed in the lease — not charged (${eur(share)} stays with the landlord)`;
            share = 0;
          } else if (lease.key_overrides[cat] && lease.key_overrides[cat] !== c.key && !(inv.allocation_key === "heating" && !settings.heizkv_exempt)) {
            const k2 = lease.key_overrides[cat]!;
            const b2 = units.map((x) => (participates(x, inv.category) ? basis(x, k2) : 0));
            const tot2 = b2.reduce((a, b) => a + b, 0);
            if (tot2 > 0) {
              const unitShare2 = Math.round((c.amount * b2[i]) / tot2);
              const share2 = c.prorated ? Math.round((unitShare2 * days) / diy) : unitShare2;
              leaseDiff += share - share2;
              f = `lease: ${eur(c.amount)} × ${b2[i]} ${KEY_UNIT[k2]} / ${tot2} ${KEY_UNIT[k2]} = ${eur(unitShare2)}` + (c.prorated && days !== diy ? ` × ${days}/${diy} days = ${eur(share2)}` : "") + ` (building default would be ${eur(share)})`;
              share = share2;
            }
          }
          tenantsTotal += share;
          const a = acc.get(t.id) ?? { share: 0, days: diy, parts: [] };
          a.share += share; a.days = Math.min(a.days, days); a.parts.push(f);
          acc.set(t.id, a);
        });
      });
    }
    if (!ok) continue;
    for (const t of tenants) {
      const a = acc.get(t.id);
      if (!a) continue;
      const formula = a.parts.length > 1 ? `${a.parts.join("; ")} → ${eur(a.share)}` : a.parts[0];
      const total = comps.reduce((s, c) => s + c.amount, 0);
      const excludedNote = excluded > 0 ? ` (${eur(excluded)} not allocable excluded)` : "";
      perTenant.get(t.id)!.push({
        invoice_id: inv.id, provider: inv.provider, category: inv.category, description: inv.description,
        allocation_key: inv.allocation_key, total_cents: total, basis_unit: 0, basis_total: 0,
        unit_share_cents: 0, days_occupied: a.days, days_in_year: diy, share_cents: a.share, formula: formula + excludedNote,
      });
    }
  }

  const statements = tenants.filter((t) => !flatRate.has(t.id)).map((t) => {
    const unit = units.find((u) => u.id === t.unit_id)!;
    const lines = perTenant.get(t.id) ?? [];
    const total = lines.reduce((s, l) => s + l.share_cents, 0);
    const months = occupiedMonths(t, year);
    const prepaid = t.monthly_prepayment_cents * months;
    const days = occupiedDays(t, year);
    const suggested = days > 0 ? Math.round((total * diy) / days / 12) : 0; // annualised, then per month
    return { tenant: t, unit, year, lines, total_cents: total, prepaid_cents: prepaid, months_occupied: months, balance_cents: total - prepaid, suggested_prepayment_cents: suggested };
  });

  const rounding = allocable - tenantsTotal - ownerVacancy - leaseDiff;
  const summary: BuildingSummary = { year, invoiced_cents: invoiced, non_allocable_cents: nonAllocable, allocable_cents: allocable, tenants_cents: tenantsTotal, owner_vacancy_cents: ownerVacancy, rounding_cents: rounding, co2_landlord_cents: co2Landlord, owner_lease_diff_cents: leaseDiff, legal_basis: RULES_VERSION };
  if (leaseDiff !== 0) checks.push({ level: leaseDiff > 0 ? "WARNING" : "INFO", code: "LEASE_DIFF", message: leaseDiff > 0 ? `Lease rules deviate from the building default — you bear ${eur(leaseDiff)} that cannot be charged to anyone.` : `Lease rules deviate from the building default — you recover ${eur(-leaseDiff)} more than the default split.`, hint: "Check the tenants' lease rules; a key agreed in a lease binds you even if the building default differs." });
  for (const t of tenants) { const l = leases.get(t.id)!; if ((Object.keys(l.key_overrides).length || l.excluded_categories.length || l.prepayment_type === "pauschale") && !l.confirmed) checks.push({ level: "BLOCKER", code: "LEASE_UNCONFIRMED", message: `${t.name}: lease rules were read by AI but not confirmed yet.`, hint: "Open the tenant, review the extracted clauses and confirm." }); }

  // § 556 (3) BGB: the statement must reach the tenant within 12 months after the period — later, no additional charges can be claimed.
  const deadline = new Date(Date.UTC(year + 1, 11, 31));
  const daysLeft = Math.floor((deadline.getTime() - today.getTime()) / DAY);
  if (daysLeft < 0) checks.push({ level: "WARNING", code: "DEADLINE_PASSED", message: `The 12-month deadline for ${year} (31 Dec ${year + 1}) has passed — you can no longer claim additional payments (§ 556 (3) BGB); refunds are still owed.` });
  else if (daysLeft <= 60) checks.push({ level: "WARNING", code: "DEADLINE_SOON", message: `${daysLeft} days left: statements for ${year} must reach tenants by 31 Dec ${year + 1} (§ 556 (3) BGB).` });
  else checks.push({ level: "INFO", code: "DEADLINE", message: `Deadline for ${year}: tenants must receive the statement by 31 Dec ${year + 1} (§ 556 (3) BGB) — ${daysLeft} days left.` });
  if (settings.heizkv_exempt) checks.push({ level: "INFO", code: "HEIZKV_EXEMPT", message: "HeizkostenV not applied (§ 11 exemption: two-unit building, landlord living in it). Heating is allocated by area." });
  if (!heatingCentral) checks.push({ level: "INFO", code: "DECENTRAL", message: "Heating type is decentral — heating and hot water are not part of this statement." });

  // ---- plausibility checks ----
  if (invoices.length === 0) checks.push({ level: "BLOCKER", code: "NO_INVOICES", message: `No invoices booked for ${year}.`, hint: "Sync the inbox or upload invoices first." });
  if (rounding !== 0) checks.push({ level: "BLOCKER", code: "SUM_MISMATCH", message: `Allocated amounts differ from the allocable total by ${eur(rounding)}.`, hint: "This should never happen — please report it." });
  const seen = new Map<string, Invoice>();
  for (const inv of invoices) {
    const k = `${inv.provider.toLowerCase()}|${inv.amount_cents}|${inv.period_start}|${inv.period_end}`;
    const dup = seen.get(k);
    if (dup) checks.push({ level: "WARNING", code: "DUPLICATE", message: `${inv.provider} ${eur(inv.amount_cents)} (${inv.period_start} – ${inv.period_end}) appears twice (#${dup.id} and #${inv.id}).`, hint: "Delete one of them if it is the same invoice." });
    else seen.set(k, inv);
    if (inv.period_end < `${year}-01-01` || inv.period_start > `${year}-12-31`) checks.push({ level: "WARNING", code: "OUT_OF_PERIOD", message: `${inv.provider}: period ${inv.period_start} – ${inv.period_end} lies outside ${year} and was ignored.` });
    if (inv.ai_confidence != null && inv.ai_confidence < 0.7) checks.push({ level: "WARNING", code: "LOW_CONFIDENCE", message: `${inv.provider}: AI read this invoice with only ${(inv.ai_confidence * 100).toFixed(0)} % confidence.`, hint: "Open the PDF and verify amount and period." });
  }
  if (nonAllocable > 0) checks.push({ level: "INFO", code: "NON_ALLOCABLE", message: `${eur(nonAllocable)} of costs are not allocable to tenants (§ 2 BetrKV) and stay with the owner.` });
  for (const u of units) {
    const occ = tenants.filter((t) => t.unit_id === u.id);
    const days = occ.reduce((s, t) => s + occupiedDays(t, year), 0);
    if (days === 0) checks.push({ level: "WARNING", code: "VACANT_ALL_YEAR", message: `${u.label} had no tenant in ${year} — its full share (${eur(0)} to tenants) stays with the owner.` });
    else if (days < diy) checks.push({ level: "INFO", code: "PARTIAL_VACANCY", message: `${u.label} was vacant for ${diy - days} days in ${year}; that share is booked to the owner, not to other tenants.` });
    else if (days > diy) checks.push({ level: "BLOCKER", code: "OVERLAP", message: `${u.label}: tenancies overlap (${days} occupied days in a ${diy}-day year).`, hint: "Fix move-in / move-out dates." });
  }
  if (ownerVacancy > 0) checks.push({ level: "INFO", code: "OWNER_SHARE", message: `${eur(ownerVacancy)} owner share due to vacancy.` });
  checks.push({ level: "INFO", code: "LEGAL_BASIS", message: `Rules: ${RULES_VERSION}. Deterministic code, integer cents, largest-remainder rounding. Not legal advice — have edge cases reviewed.` });

  return { statements, summary, checks };
}
