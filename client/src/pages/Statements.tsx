import { useEffect, useState } from "react";
import { api, CATEGORY_LABEL, KEY_LABEL, type Check, type Property, type Run, type Statement } from "../api";
import { Badge, Button, Card, inputCls, Money, PageTitle, Spinner } from "../ui";

const YEAR = new Date().getFullYear() - 1;
const EMPTY: Run = { statements: [], summary: null, checks: [], created_at: null };

export default function Statements({ property, onChange }: { property: Property; onChange: () => void }) {
  const [year, setYear] = useState(YEAR);
  const [run, setRun] = useState<Run>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = () => api.statements(property.id, year).then(setRun);
  useEffect(() => { load(); }, [property.id, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => { setBusy(true); setMsg(""); try { setRun(await api.generate(property.id, year)); } catch (e) { setMsg((e as Error).message); } setBusy(false); };
  const blockers = run.checks.filter((c) => c.level === "BLOCKER");
  const sendAll = async () => {
    setBusy(true); setMsg("");
    let ok = 0; const errs: string[] = [];
    for (const s of run.statements) { try { await api.send(s.id); ok++; } catch (e) { errs.push((e as Error).message); } }
    setMsg(`Sent ${ok} of ${run.statements.length} statements.${errs.length ? " Errors: " + errs.join("; ") : ""}`);
    await load(); onChange(); setBusy(false);
  };

  const { statements, summary } = run;
  const owed = statements.reduce((s, x) => s + Math.max(0, x.balance_cents), 0);
  const refunds = statements.reduce((s, x) => s + Math.max(0, -x.balance_cents), 0);

  return (
    <>
      <PageTitle title="Statements" sub="Per-tenant annual statements — deterministic, every line shows its formula, vacancy stays with the owner."
        right={
          <div className="flex items-center gap-2">
            <select className={inputCls + " w-auto"} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[YEAR + 1, YEAR, YEAR - 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button variant="ghost" onClick={generate} disabled={busy}>{busy ? <Spinner /> : null} {statements.length ? "Recalculate" : "Generate statements"}</Button>
            <Button onClick={sendAll} disabled={busy || statements.length === 0 || blockers.length > 0} title={blockers.length ? "Resolve blockers first" : ""}>Send all to tenants</Button>
          </div>
        } />
      {msg && <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">{msg}</div>}

      {statements.length === 0 && <Card className="p-10 text-center text-sm text-slate-500">No statements for {year} yet. Book the invoices first, then click <b>Generate statements</b>.</Card>}

      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-4">
          <Card className="p-5">
            <div className="mb-3 text-sm font-medium">Building reconciliation {year}</div>
            <dl className="space-y-1 text-sm">
              <Row k="Invoiced" v={summary.invoiced_cents} />
              <Row k="− not allocable (§ 2 BetrKV), owner" v={summary.non_allocable_cents} muted />
              <Row k="= allocable" v={summary.allocable_cents} bold />
              <Row k="→ allocated to tenants" v={summary.tenants_cents} />
              <Row k="→ owner share due to vacancy" v={summary.owner_vacancy_cents} tone={summary.owner_vacancy_cents > 0 ? "amber" : undefined} />
              <Row k="→ rounding difference" v={summary.rounding_cents} tone={summary.rounding_cents === 0 ? "green" : "red"} />
            </dl>
            <div className="mt-3 text-xs text-slate-500">Tenants owe <Money cents={owed} /> · refunds <Money cents={refunds} /> · {statements.filter((s) => s.sent_at).length}/{statements.length} sent</div>
          </Card>
          <Checks checks={run.checks} />
        </div>
      )}

      <div className="space-y-4">
        {statements.map((s) => <StatementCard key={s.id} s={s} property={property} blocked={blockers.length > 0} onChange={async () => { await load(); onChange(); }} />)}
      </div>
    </>
  );
}

function Row({ k, v, bold, muted, tone }: { k: string; v: number; bold?: boolean; muted?: boolean; tone?: "amber" | "green" | "red" }) {
  const c = tone === "amber" ? "text-amber-700" : tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "";
  return <div className={`flex justify-between ${bold ? "font-semibold" : ""} ${muted ? "text-slate-500" : ""} ${c}`}><dt>{k}</dt><dd><Money cents={v} /></dd></div>;
}

function Checks({ checks }: { checks: Check[] }) {
  const tone = { BLOCKER: "red", WARNING: "amber", INFO: "slate" } as const;
  const order = { BLOCKER: 0, WARNING: 1, INFO: 2 };
  const sorted = [...checks].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <Card className="p-5">
      <div className="mb-3 text-sm font-medium">Checks <span className="font-normal text-slate-500">· {checks.filter((c) => c.level === "BLOCKER").length} blockers, {checks.filter((c) => c.level === "WARNING").length} warnings</span></div>
      <ul className="max-h-56 space-y-2 overflow-auto text-sm">
        {sorted.map((c, i) => (
          <li key={i} className="flex gap-2"><Badge tone={tone[c.level]}>{c.level}</Badge><div><div>{c.message}</div>{c.hint && <div className="text-xs text-slate-500">{c.hint}</div>}</div></li>
        ))}
      </ul>
    </Card>
  );
}

function StatementCard({ s, property, blocked, onChange }: { s: Statement; property: Property; blocked: boolean; onChange: () => void }) {
  const tenant = property.tenants.find((t) => t.id === s.tenant_id)!;
  const unit = property.units.find((u) => u.id === tenant.unit_id)!;
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const partial = s.lines.some((l) => l.days_occupied < l.days_in_year);
  return (
    <Card>
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="flex-1">
          <div className="font-medium">{tenant.name} <span className="font-normal text-slate-500">· {unit.label} · {unit.area_sqm} m²</span> {partial && <Badge tone="amber">partial year</Badge>}</div>
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
          <Button variant="ghost" disabled={sending || blocked} onClick={async () => { setSending(true); setErr(""); try { await api.send(s.id); onChange(); } catch (e) { setErr((e as Error).message); } setSending(false); }}>{sending ? <Spinner /> : null} {s.sent_at ? "Resend" : "Send"}</Button>
          <Button variant="ghost" onClick={() => setOpen(!open)}>{open ? "Hide" : "Lines"}</Button>
        </div>
      </div>
      {err && <div className="px-5 pb-3 text-xs text-red-600">{err}</div>}
      {open && (
        <table className="w-full border-t border-slate-100 text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="px-5 py-2">Cost</th><th className="px-5 py-2">Calculation</th><th className="px-5 py-2 text-right">Building</th><th className="px-5 py-2 text-right">Share</th></tr></thead>
          <tbody>
            {s.lines.map((l, i) => (
              <tr key={i} className="border-t border-slate-50">
                <td className="px-5 py-2">{CATEGORY_LABEL[l.category] ?? l.category}<div className="text-xs text-slate-500">{l.description} · {l.provider}</div></td>
                <td className="px-5 py-2 text-xs text-slate-600"><div className="text-slate-500">{KEY_LABEL[l.allocation_key]}</div><code className="font-mono">{l.formula}</code></td>
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
