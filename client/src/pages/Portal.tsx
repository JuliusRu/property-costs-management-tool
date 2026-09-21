import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, CATEGORY_LABEL, KEY_LABEL } from "../api";
import { Badge, Card, Money, Wordmark } from "../ui";

type Data = Awaited<ReturnType<typeof api.portal>>;

export default function Portal() {
  const { token = "" } = useParams();
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.portal(token).then(setD).catch(() => setErr("This link is not valid. Ask your landlord for a new one.")); }, [token]);
  if (err) return <div className="p-10 text-center text-mute">{err}</div>;
  if (!d) return <div className="p-10 text-center text-mute">Loading…</div>;
  return (
    <div className="min-h-screen bg-surface">
      <header className="bg-ink text-white"><div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3"><Wordmark light /><span className="text-sm text-white/60">Tenant portal</span></div></header>
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="display text-4xl">Hello {d.tenant.name.split(" ")[0]}</h1>
        <p className="mt-2 text-mute">{d.property.name}, {d.unit.label} · {d.unit.area_sqm} m² · you prepay <Money cents={d.tenant.monthly_prepayment_cents} /> a month</p>

        {d.statements.length === 0 && <Card className="mt-8 p-8 text-center text-sm text-mute">No statements yet. Every annual statement will appear here, each line traceable to the original provider invoice.</Card>}

        {d.statements.map((s) => (
          <Card key={s.id} className="mt-8 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
              <div>
                <div className="text-xl font-bold">Operating costs {s.year}</div>
                <div className="mt-1">{s.sent_at ? <Badge tone="green">issued {s.sent_at.slice(0, 10)}</Badge> : <Badge tone="amber">draft</Badge>}</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-medium text-mute">{s.balance_cents > 0 ? "You pay" : "You get back"}</div>
                <div className={`display num text-4xl ${s.balance_cents > 0 ? "text-ember" : "text-mint"}`}>{(Math.abs(s.balance_cents) / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</div>
              </div>
            </div>
            <table className="w-full border-t border-line text-sm">
              <thead className="text-left text-xs text-mute"><tr><th className="px-6 py-2 font-medium">Cost</th><th className="px-6 py-2 font-medium">How your share is calculated</th><th className="px-6 py-2 text-right font-medium">Your share</th></tr></thead>
              <tbody className="divide-y divide-line">
                {s.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-6 py-2.5 align-top"><div className="font-medium">{CATEGORY_LABEL[l.category] ?? l.category}</div>
                      <div className="text-xs text-mute">{l.provider} · <a className="font-semibold text-cobalt hover:underline" href={`/api/portal/${token}/invoice/${l.invoice_id}/file`} target="_blank" rel="noreferrer">see the invoice</a></div></td>
                    <td className="px-6 py-2.5 align-top text-xs"><div className="text-mute">{KEY_LABEL[l.allocation_key]}</div><div className="num mt-0.5 text-ink-soft">{l.formula}</div></td>
                    <td className="num px-6 py-2.5 text-right align-top font-semibold"><Money cents={l.share_cents} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line text-sm">
                <tr><td className="px-6 py-2" colSpan={2}>Your costs</td><td className="num px-6 py-2 text-right"><Money cents={s.total_cents} /></td></tr>
                <tr><td className="px-6 py-2" colSpan={2}>Your prepayments</td><td className="num px-6 py-2 text-right">− <Money cents={s.prepaid_cents} /></td></tr>
                <tr className="font-bold"><td className="px-6 py-3" colSpan={2}>{s.balance_cents > 0 ? "Balance due" : "Refund"}</td><td className="num px-6 py-3 text-right"><Money cents={Math.abs(s.balance_cents)} /></td></tr>
              </tfoot>
            </table>
          </Card>
        ))}
        <p className="mt-8 text-center text-xs text-mute">Computed under § 556 BGB / BetrKV with deterministic rules. Days when the flat was empty are charged to the owner, never to you. You can object within 12 months of receipt.</p>
      </div>
    </div>
  );
}
