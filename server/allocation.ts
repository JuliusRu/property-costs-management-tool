import type { AllocationKey, Invoice, Tenant, Unit } from "./db.js";

export type StatementLine = {
  invoice_id: number;
  provider: string;
  category: string;
  description: string | null;
  allocation_key: AllocationKey;
  total_cents: number;      // building total for the year (pro-rated if the invoice period crosses years)
  basis_unit: number;       // this unit's share basis (e.g. 58 m²)
  basis_total: number;      // total basis across the building (e.g. 178 m²)
  unit_share_cents: number; // the unit's full-year share before occupancy
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
};

export type BuildingSummary = {
  year: number;
  invoiced_cents: number;        // all invoices of the year, allocable or not
  non_allocable_cents: number;   // excluded (§ 2 BetrKV)
  allocable_cents: number;
  tenants_cents: number;         // allocated to tenants
  owner_vacancy_cents: number;   // stays with the owner because units were vacant
  rounding_cents: number;        // must be 0 — invariant
};

export type Check = { level: "BLOCKER" | "WARNING" | "INFO"; code: string; message: string; hint?: string };

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
export function computeStatements(units: Unit[], tenants: Tenant[], invoices: Invoice[], year: number): { statements: TenantStatement[]; summary: BuildingSummary; checks: Check[] } {
  const diy = daysInYear(year);
  const perTenant = new Map<number, StatementLine[]>();
  for (const t of tenants) perTenant.set(t.id, []);
  let allocable = 0, nonAllocable = 0, tenantsTotal = 0, ownerVacancy = 0, invoiced = 0;
  const checks: Check[] = [];

  for (const inv of invoices) {
    const months = monthsOverlap(inv.period_start, inv.period_end, year);
    if (months === 0) continue;
    const pm = periodMonths(inv.period_start, inv.period_end);
    const yearAmount = pm === months ? inv.amount_cents : Math.round((inv.amount_cents * months) / pm);
    invoiced += yearAmount;
    if (pm !== months) checks.push({ level: "INFO", code: "PRORATED", message: `${inv.provider} (${inv.description ?? inv.category}) covers ${pm} months; ${months} of them fall into ${year} → ${eur(yearAmount)} of ${eur(inv.amount_cents)} used.` });
    if (!inv.allocable) { nonAllocable += yearAmount; continue; }
    allocable += yearAmount;

    const key = inv.allocation_key;
    const bases = units.map((u) => basis(u, key));
    const basisTotal = bases.reduce((s, b) => s + b, 0);
    if (basisTotal === 0) { checks.push({ level: "BLOCKER", code: "NO_BASIS", message: `${inv.provider}: allocation key "${key}" has no data on any unit.`, hint: "Enter the values on the units or choose a different key." }); continue; }
    const unitShares = splitCents(yearAmount, bases);

    units.forEach((u, i) => {
      const unitShare = unitShares[i];
      const occupants = tenants.filter((t) => t.unit_id === u.id);
      const dayWeights = occupants.map((t) => (TIME_PRORATED[key] ? occupiedDays(t, year) : diy));
      const occupiedSum = dayWeights.reduce((s, d) => s + d, 0);
      // For consumption keys the whole unit share goes to the occupant(s); otherwise vacancy days stay with the owner.
      const weights = TIME_PRORATED[key] ? [...dayWeights, Math.max(0, diy - occupiedSum)] : [...dayWeights, 0];
      const parts = splitCents(unitShare, weights);
      const vacancyPart = parts[parts.length - 1];
      ownerVacancy += vacancyPart;

      occupants.forEach((t, j) => {
        const days = TIME_PRORATED[key] ? dayWeights[j] : diy;
        const share = parts[j];
        tenantsTotal += share;
        const base = `${eur(yearAmount)} × ${bases[i]} ${KEY_UNIT[key]} / ${basisTotal} ${KEY_UNIT[key]} = ${eur(unitShare)}`;
        const formula = TIME_PRORATED[key] && days !== diy
          ? `${base}; × ${days} / ${diy} days occupied = ${eur(share)}`
          : `${base}`;
        perTenant.get(t.id)!.push({
          invoice_id: inv.id, provider: inv.provider, category: inv.category, description: inv.description,
          allocation_key: key, total_cents: yearAmount, basis_unit: bases[i], basis_total: basisTotal,
          unit_share_cents: unitShare, days_occupied: days, days_in_year: diy, share_cents: share, formula,
        });
      });
    });
  }

  const statements = tenants.map((t) => {
    const unit = units.find((u) => u.id === t.unit_id)!;
    const lines = perTenant.get(t.id) ?? [];
    const total = lines.reduce((s, l) => s + l.share_cents, 0);
    const months = occupiedMonths(t, year);
    const prepaid = t.monthly_prepayment_cents * months;
    return { tenant: t, unit, year, lines, total_cents: total, prepaid_cents: prepaid, months_occupied: months, balance_cents: total - prepaid };
  });

  const rounding = allocable - tenantsTotal - ownerVacancy;
  const summary: BuildingSummary = { year, invoiced_cents: invoiced, non_allocable_cents: nonAllocable, allocable_cents: allocable, tenants_cents: tenantsTotal, owner_vacancy_cents: ownerVacancy, rounding_cents: rounding };

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
  checks.push({ level: "INFO", code: "LEGAL_BASIS", message: "Computed under § 556 BGB / BetrKV, deterministic code, integer cents, largest-remainder rounding. This is not legal advice — have edge cases reviewed." });

  return { statements, summary, checks };
}
