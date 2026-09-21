import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, CATEGORY_LABEL, KEY_LABEL } from "../api";
import { APP_NAME, Badge, Card, Money } from "../ui";

type Data = Awaited<ReturnType<typeof api.portal>>;

export default function Portal() {
  const { token = "" } = useParams();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.portal(token).then(setD).catch(() => setErr("This link is not valid.")); }, [token]);
  if (err) return <div className="p-10 text-center text-slate-500">{err}</div>;
  if (!d) return <div className="p-10 text-center text-slate-500">Loading…</div>;
  return (
    <div className="mx-auto max-w-3xl p-6 md:p-10">
      <div className="mb-8">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{APP_NAME} · tenant portal</div>
        <h1 className="mt-1 text-2xl font-semibold">Hello {d.tenant.name}</h1>
        <p className="text-sm text-slate-500">{d.property.name}, {d.unit.label} · {d.unit.area_sqm} m² · {d.unit.persons} person{d.unit.persons > 1 ? "s" : ""} · prepaying <Money cents={d.tenant.monthly_prepayment_cents} /> / month</p>
      </div>

      {d.statements.length === 0 && <Card className="p-8 text-center text-sm text-slate-500">No statements yet. You'll see every annual statement here, with each line traceable to the original provider invoice.</Card>}

      {d.statements.map((s) => (
        <Card key={s.id} className="mb-6">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <div>
              <div className="text-lg font-semibold">Operating cost statement {s.year}</div>
              <div className="text-xs text-slate-500">{s.sent_at ? <Badge tone="green">issued {s.sent_at.slice(0, 10)}</Badge> : <Badge tone="amber">draft</Badge>}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">{s.balance_cents > 0 ? "You pay" : "You get back"}</div>
              <div className={`text-2xl font-semibold ${s.balance_cents > 0 ? "text-red-600" : "text-emerald-600"}`}><Money cents={Math.abs(s.balance_cents)} /></div>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="px-6 py-2">Cost</th><th className="px-6 py-2">How it's split</th><th className="px-6 py-2 text-right">Building</th><th className="px-6 py-2 text-right">Your share</th></tr></thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={i} className="border-t border-slate-50">
                  <td className="px-6 py-2">{CATEGORY_LABEL[l.category] ?? l.category}
                    <div className="text-xs text-slate-500">{l.provider} · <a className="underline" href={`/api/portal/${token}/invoice/${l.invoice_id}/file`} target="_blank" rel="noreferrer">original invoice</a></div></td>
                  <td className="px-6 py-2 text-slate-600">{KEY_LABEL[l.allocation_key]}<div className="text-xs text-slate-500">{l.basis_unit} of {l.basis_total}</div></td>
                  <td className="px-6 py-2 text-right"><Money cents={l.total_cents} /></td>
                  <td className="px-6 py-2 text-right font-medium"><Money cents={l.share_cents} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 text-sm">
              <tr><td className="px-6 py-2" colSpan={3}>Your total costs</td><td className="px-6 py-2 text-right"><Money cents={s.total_cents} /></td></tr>
              <tr><td className="px-6 py-2" colSpan={3}>Your prepayments</td><td className="px-6 py-2 text-right">− <Money cents={s.prepaid_cents} /></td></tr>
              <tr className="font-semibold"><td className="px-6 py-3" colSpan={3}>{s.balance_cents > 0 ? "Balance due" : "Refund"}</td><td className="px-6 py-3 text-right"><Money cents={Math.abs(s.balance_cents)} /></td></tr>
            </tfoot>
          </table>
        </Card>
      ))}
      <p className="text-center text-xs text-slate-400">Statements follow § 556 BGB / BetrKV. Objections within 12 months of receipt.</p>
    </div>
  );
}
