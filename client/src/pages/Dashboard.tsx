import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Invoice, type Property } from "../api";
import { Card, Money, PageTitle, Badge } from "../ui";

export default function Dashboard({ property }: { property: Property }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  useEffect(() => { api.invoices(property.id).then(setInvoices); }, [property.id]);
  const year = new Date().getFullYear() - 1;
  const thisYear = invoices.filter((i) => i.period_start.startsWith(String(year)));
  const total = thisYear.filter((i) => i.allocable).reduce((s, i) => s + i.amount_cents, 0);
  const prepaid = property.tenants.reduce((s, t) => s + t.monthly_prepayment_cents * 12, 0);
  const totalArea = property.units.reduce((s, u) => s + u.area_sqm, 0);

  return (
    <>
      <PageTitle title={property.name} sub={property.address} />
      <div className="mb-8 grid grid-cols-4 gap-4">
        <Stat label="Units" value={String(property.units.length)} sub={`${totalArea} m² total`} />
        <Stat label={`Invoices ${year}`} value={String(thisYear.length)} sub={`${thisYear.filter((i) => i.source === "sync").length} pulled automatically`} />
        <Stat label={`Allocable costs ${year}`} value={<Money cents={total} />} sub="across all units" />
        <Stat label={`Prepayments ${year}`} value={<Money cents={prepaid} />} sub={<span className={total - prepaid > 0 ? "text-red-600" : "text-emerald-600"}>{total - prepaid > 0 ? "tenants owe" : "refunds due"} <Money cents={Math.abs(total - prepaid)} /></span>} />
      </div>

      <Card>
        <div className="border-b border-slate-200 px-5 py-3 text-sm font-medium">Units & tenants</div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="px-5 py-2">Unit</th><th className="px-5 py-2">Tenant</th><th className="px-5 py-2">Area</th><th className="px-5 py-2">Persons</th><th className="px-5 py-2">Heating</th><th className="px-5 py-2">Water</th><th className="px-5 py-2 text-right">Prepayment / month</th></tr>
          </thead>
          <tbody>
            {property.units.map((u) => {
              const t = property.tenants.find((t) => t.unit_id === u.id);
              return (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 font-medium">{u.label}</td>
                  <td className="px-5 py-3">{t ? <>{t.name}<div className="text-xs text-slate-500">{t.email}{t.move_in && t.move_in > `${year}-01-01` && <> · <Badge tone="amber">moved in {t.move_in}</Badge></>}</div></> : <Badge tone="amber">vacant</Badge>}</td>
                  <td className="px-5 py-3">{u.area_sqm} m²</td>
                  <td className="px-5 py-3">{u.persons}</td>
                  <td className="px-5 py-3">{u.heating_kwh.toLocaleString("de-DE")} kWh</td>
                  <td className="px-5 py-3">{u.water_m3} m³</td>
                  <td className="px-5 py-3 text-right">{t && <Money cents={t.monthly_prepayment_cents} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <Link to="/invoices" className="rounded-xl border border-dashed border-slate-300 p-5 text-sm hover:bg-white">
          <div className="font-medium">1 · Collect invoices</div>
          <div className="mt-1 text-slate-500">Sync the inbox or upload provider invoices. AI extracts amount, period, category and allocation key.</div>
        </Link>
        <Link to="/statements" className="rounded-xl border border-dashed border-slate-300 p-5 text-sm hover:bg-white">
          <div className="font-medium">2 · Generate & send statements</div>
          <div className="mt-1 text-slate-500">One click per year: every tenant gets a statement, a PDF and a portal link to verify each line.</div>
        </Link>
      </div>
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </Card>
  );
}
