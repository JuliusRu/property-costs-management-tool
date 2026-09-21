import type { AllocationKey, Invoice, Tenant, Unit } from "./db.js";

export type StatementLine = {
  invoice_id: number;
  provider: string;
  category: string;
  description: string | null;
  allocation_key: AllocationKey;
  total_cents: number;
  basis_unit: number;   // this unit's share basis (e.g. 58 m²)
  basis_total: number;  // total basis across property (e.g. 178 m²)
  share_cents: number;
};

export type TenantStatement = {
  tenant: Tenant;
  unit: Unit;
  year: number;
  lines: StatementLine[];
  total_cents: number;
  prepaid_cents: number;
  balance_cents: number; // positive = tenant owes, negative = refund
};

function basis(unit: Unit, key: AllocationKey): number {
  switch (key) {
    case "area": return unit.area_sqm;
    case "persons": return unit.persons;
    case "units": return 1;
    case "heating": return unit.heating_kwh;
    case "water": return unit.water_m3;
  }
}

// Months of the year the invoice period overlaps, so partial-year invoices are pro-rated.
function monthsInYear(periodStart: string, periodEnd: string, year: number): number {
  const s = new Date(periodStart), e = new Date(periodEnd);
  const ys = new Date(`${year}-01-01`), ye = new Date(`${year}-12-31`);
  const from = s > ys ? s : ys, to = e < ye ? e : ye;
  if (to < from) return 0;
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1;
}

/**
 * Distribute every allocable invoice of a year across units by its allocation key,
 * then net each tenant's share against their prepayments.
 * Rounding: largest-remainder so the shares always sum to the invoice total.
 */
export function computeStatements(
  units: Unit[],
  tenants: Tenant[],
  invoices: Invoice[],
  year: number
): TenantStatement[] {
  const perUnitLines = new Map<number, StatementLine[]>();
  for (const u of units) perUnitLines.set(u.id, []);

  for (const inv of invoices) {
    if (!inv.allocable) continue;
    const months = monthsInYear(inv.period_start, inv.period_end, year);
    if (months === 0) continue;
    const periodMonths = monthsInYear(inv.period_start, inv.period_end, Number(inv.period_start.slice(0, 4))) +
      (inv.period_end.slice(0, 4) !== inv.period_start.slice(0, 4)
        ? monthsInYear(inv.period_start, inv.period_end, Number(inv.period_end.slice(0, 4))) : 0);
    const yearAmount = Math.round((inv.amount_cents * months) / periodMonths);

    const key = inv.allocation_key;
    const basisTotal = units.reduce((s, u) => s + basis(u, key), 0);
    if (basisTotal === 0) continue;

    // largest-remainder rounding
    const raw = units.map((u) => (yearAmount * basis(u, key)) / basisTotal);
    const floored = raw.map(Math.floor);
    let rest = yearAmount - floored.reduce((a, b) => a + b, 0);
    const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac);
    for (const { i } of order) { if (rest <= 0) break; floored[i]++; rest--; }

    units.forEach((u, i) => {
      perUnitLines.get(u.id)!.push({
        invoice_id: inv.id,
        provider: inv.provider,
        category: inv.category,
        description: inv.description,
        allocation_key: key,
        total_cents: yearAmount,
        basis_unit: basis(u, key),
        basis_total: basisTotal,
        share_cents: floored[i],
      });
    });
  }

  return tenants.map((t) => {
    const unit = units.find((u) => u.id === t.unit_id)!;
    const lines = perUnitLines.get(unit.id) ?? [];
    const total = lines.reduce((s, l) => s + l.share_cents, 0);
    const prepaid = t.monthly_prepayment_cents * 12;
    return { tenant: t, unit, year, lines, total_cents: total, prepaid_cents: prepaid, balance_cents: total - prepaid };
  });
}
