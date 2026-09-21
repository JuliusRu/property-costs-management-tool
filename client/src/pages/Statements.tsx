import { useEffect, useState } from "react";
import { api, CATEGORY_LABEL, KEY_LABEL, type Property, type Statement } from "../api";
import { Badge, Button, Card, inputCls, Money, PageTitle, Spinner } from "../ui";

const YEAR = new Date().getFullYear() - 1;

export default function Statements({ property, onChange }: { property: Property; onChange: () => void }) {
  const [year, setYear] = useState(YEAR);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = () => api.statements(property.id, year).then(setStatements);
  useEffect(() => { load(); }, [property.id, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => { setBusy(true); setMsg(""); try { setStatements(await api.generate(property.id, year)); } catch (e) { setMsg((e as Error).message); } setBusy(false); };
  const sendAll = async () => {
    setBusy(true); setMsg("");
    let ok = 0; const errs: string[] = [];
    for (const s of statements) { try { await api.send(s.id); ok++; } catch (e) { errs.push((e as Error).message); } }
    setMsg(`Sent ${ok} of ${statements.length} statements.${errs.length ? " Errors: " + errs.join("; ") : ""}`);
    await load(); onChange(); setBusy(false);
  };

  const owed = statements.reduce((s, x) => s + Math.max(0, x.balance_cents), 0);
  const refunds = statements.reduce((s, x) => s + Math.max(0, -x.balance_cents), 0);

  return (
    <>
      <PageTitle title="Statements" sub="Per-tenant annual statements — computed from the booked invoices, sent as PDF with a portal link."
        right={
          <div className="flex items-center gap-2">
            <select className={inputCls + " w-auto"} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[YEAR + 1, YEAR, YEAR - 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button variant="ghost" onClick={generate} disabled={busy}>{busy ? <Spinner /> : null} {statements.length ? "Recalculate" : "Generate statements"}</Button>
            <Button onClick={sendAll} disabled={busy || statements.length === 0}>Send all to tenants</Button>
          </div>
        } />
      {msg && <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">{msg}</div>}

      {statements.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          <Card className="p-4"><div className="text-xs text-slate-500">Statements</div><div className="mt-1 text-xl font-semibold">{statements.length} <span className="text-sm font-normal text-slate-500">· {statements.filter((s) => s.sent_at).length} sent</span></div></Card>
          <Card className="p-4"><div className="text-xs text-slate-500">Tenants owe you</div><div className="mt-1 text-xl font-semibold text-red-600"><Money cents={owed} /></div></Card>
          <Card className="p-4"><div className="text-xs text-slate-500">You refund</div><div className="mt-1 text-xl font-semibold text-emerald-600"><Money cents={refunds} /></div></Card>
        </div>
      )}

      {statements.length === 0 && <Card className="p-10 text-center text-sm text-slate-500">No statements for {year} yet. Book the invoices first, then click <b>Generate statements</b>.</Card>}

      <div className="space-y-4">
        {statements.map((s) => <StatementCard key={s.id} s={s} property={property} onChange={async () => { await load(); onChange(); }} />)}
      </div>
    </>
  );
}

function StatementCard({ s, property, onChange }: { s: Statement; property: Property; onChange: () => void }) {
  const tenant = property.tenants.find((t) => t.id === s.tenant_id)!;
  const unit = property.units.find((u) => u.id === tenant.unit_id)!;
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  return (
    <Card>
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="flex-1">
          <div className="font-medium">{tenant.name} <span className="font-normal text-slate-500">· {unit.label} · {unit.area_sqm} m²</span></div>
          <div className="text-xs text-slate-500">{tenant.email} · costs <Money cents={s.total_cents} /> − prepaid <Money cents={s.prepaid_cents} /></div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">{s.balance_cents > 0 ? "Tenant pays" : "Refund"}</div>
          <Money cents={s.balance_cents} signed />
        </div>
        <div className="flex items-center gap-2 pl-4">
          {s.sent_at ? <Badge tone="green">sent {s.sent_at.slice(0, 10)}</Badge> : <Badge tone="amber">not sent</Badge>}
          <a className="text-sm underline" href={`/api/statements/${s.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
          <a className="text-sm underline" href={`/portal/${tenant.portal_token}`} target="_blank" rel="noreferrer">Portal</a>
          <Button variant="ghost" onClick={async () => { setSending(true); setErr(""); try { await api.send(s.id); onChange(); } catch (e) { setErr((e as Error).message); } setSending(false); }} disabled={sending}>{sending ? <Spinner /> : null} {s.sent_at ? "Resend" : "Send"}</Button>
          <Button variant="ghost" onClick={() => setOpen(!open)}>{open ? "Hide" : "Lines"}</Button>
        </div>
      </div>
      {err && <div className="px-5 pb-3 text-xs text-red-600">{err}</div>}
      {open && (
        <table className="w-full border-t border-slate-100 text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="px-5 py-2">Cost</th><th className="px-5 py-2">Allocation</th><th className="px-5 py-2 text-right">Building total</th><th className="px-5 py-2 text-right">Share</th></tr></thead>
          <tbody>
            {s.lines.map((l, i) => (
              <tr key={i} className="border-t border-slate-50">
                <td className="px-5 py-2">{CATEGORY_LABEL[l.category] ?? l.category}<div className="text-xs text-slate-500">{l.description} · {l.provider}</div></td>
                <td className="px-5 py-2 text-slate-600">{KEY_LABEL[l.allocation_key]} · {l.basis_unit} / {l.basis_total}</td>
                <td className="px-5 py-2 text-right"><Money cents={l.total_cents} /></td>
                <td className="px-5 py-2 text-right"><Money cents={l.share_cents} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
