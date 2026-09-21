import { useEffect, useState } from "react";
import { api, type Check, type PaymentStatus, type Property, type Run, type Statement } from "../api";
import { Badge, BigMoney, Button, Card, Empty, Field, inputCls, Modal, Money, Notice, PageTitle, Spinner } from "../ui";
import { useT, type Key } from "../i18n";

const YEAR = new Date().getFullYear() - 1;
const EMPTY: Run = { statements: [], summary: null, checks: [], created_at: null };

export default function Statements({ property, onChange }: { property: Property; onChange: () => void }) {
  const t = useT();
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
    setMsg(t("s.sent", { ok, n: run.statements.length }) + (errs.length ? " " + t("i.errors") + errs.join("; ") : ""));
    await load(); onChange(); setBusy(false);
  };

  const { statements, summary } = run;
  const owed = statements.reduce((s, x) => s + Math.max(0, x.balance_cents), 0);
  const refunds = statements.reduce((s, x) => s + Math.max(0, -x.balance_cents), 0);

  return (
    <>
      <PageTitle title={t("s.title")} sub={t("s.sub")}
        right={
          <div className="flex items-center gap-2">
            <select className={inputCls + " w-auto"} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[YEAR + 1, YEAR, YEAR - 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <Button variant={statements.length ? "ghost" : "primary"} onClick={generate} disabled={busy}>{busy ? <Spinner /> : null} {statements.length ? t("s.recalc") : t("s.generate")}</Button>
            {statements.length > 0 && <Button onClick={sendAll} disabled={busy || blockers.length > 0} title={blockers.length ? t("s.blocked") : ""}>{t("s.sendAll")}</Button>}
          </div>
        } />
      {msg && <Notice>{msg}</Notice>}

      {statements.length === 0 && <Empty title={t("s.empty", { y: year })}>{t("s.empty.sub")}</Empty>}

      {summary && (
        <div className="mb-8 grid gap-4 lg:grid-cols-5">
          <Card className="p-5 lg:col-span-2">
            <div className="mb-3 font-semibold">{t("s.where", { y: year })}</div>
            <dl className="space-y-1.5 text-sm">
              <Row k={t("s.invoiced")} v={summary.invoiced_cents} />
              <Row k={t("s.nonAlloc")} v={-summary.non_allocable_cents} muted />
              {summary.co2_landlord_cents > 0 && <Row k={"   " + t("s.co2")} v={-summary.co2_landlord_cents} muted />}
              <Row k={t("s.allocable")} v={summary.allocable_cents} bold />
              <Row k={t("s.toTenants")} v={summary.tenants_cents} />
              <Row k={t("s.vacancy")} v={summary.owner_vacancy_cents} tone={summary.owner_vacancy_cents > 0 ? "amber" : undefined} />
              {summary.owner_lease_diff_cents !== 0 && <Row k={t("s.leaseDiff")} v={summary.owner_lease_diff_cents} tone="amber" />}
              <Row k={t("s.rounding")} v={summary.rounding_cents} tone={summary.rounding_cents === 0 ? "green" : "red"} />
            </dl>
            <div className="mt-3 text-xs text-mute">{t("s.rules")}: {summary.legal_basis}</div>
            <div className="mt-4 flex gap-6 border-t border-line pt-3 text-sm">
              <div><div className="text-xs text-mute">{t("s.tenantsPay")}</div><Money cents={owed} className="font-bold text-ember" /></div>
              <div><div className="text-xs text-mute">{t("s.youRefund")}</div><Money cents={refunds} className="font-bold text-mint" /></div>
              <div><div className="text-xs text-mute">{t("s.sentCount")}</div><span className="font-bold">{statements.filter((s) => s.sent_at).length}/{statements.length}</span></div>
            </div>
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
  const c = tone === "amber" ? "text-[#8a5a00]" : tone === "green" ? "text-mint" : tone === "red" ? "text-ember" : "";
  return <div className={`flex justify-between ${bold ? "font-bold" : ""} ${muted ? "text-mute" : ""} ${c}`}><dt>{k}</dt><dd><Money cents={v} /></dd></div>;
}

function Checks({ checks }: { checks: Check[] }) {
  const t = useT();
  const tone = { BLOCKER: "red", WARNING: "amber", INFO: "slate" } as const;
  const order = { BLOCKER: 0, WARNING: 1, INFO: 2 };
  const sorted = [...checks].sort((a, b) => order[a.level] - order[b.level]);
  const nb = checks.filter((c) => c.level === "BLOCKER").length, nw = checks.filter((c) => c.level === "WARNING").length;
  return (
    <Card className="p-5 lg:col-span-3">
      <div className="mb-3 flex items-center gap-2 font-semibold">{t("s.checks")} {nb === 0 && nw === 0 ? <Badge tone="green">{t("s.ready")}</Badge> : nb > 0 ? <Badge tone="red">{t("s.blocking", { n: nb })}</Badge> : <Badge tone="amber">{t("s.toReview", { n: nw })}</Badge>}</div>
      <ul className="max-h-64 space-y-2 overflow-auto text-sm">
        {sorted.map((c, i) => (
          <li key={i} className="flex gap-2"><span className="shrink-0"><Badge tone={tone[c.level]}>{t(`s.lvl.${c.level}` as Key)}</Badge></span><div><div>{c.message}</div>{c.hint && <div className="text-xs text-mute">{c.hint}</div>}</div></li>
        ))}
      </ul>
    </Card>
  );
}

function StatementCard({ s, property, blocked, onChange }: { s: Statement; property: Property; blocked: boolean; onChange: () => void }) {
  const t = useT();
  const tenant = property.tenants.find((x) => x.id === s.tenant_id)!;
  const unit = property.units.find((u) => u.id === tenant.unit_id)!;
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const partial = s.lines.some((l) => l.days_occupied < l.days_in_year);
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-5 px-6 py-5">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold">{tenant.name} <span className="font-normal text-mute">· {unit.label}</span> {partial && <Badge tone="amber">{t("s.partial")}</Badge>}</div>
          <div className="num text-sm text-mute">{t("s.costs")} <Money cents={s.total_cents} /> − {t("s.prepaid")} <Money cents={s.prepaid_cents} /> · {tenant.email}</div>
        </div>
        <BigMoney cents={s.balance_cents} label={s.balance_cents > 0 ? t("s.pays") : t("s.refund")} />
        <div className="flex items-center gap-2 border-l border-line pl-5">
          {s.sent_at ? <Badge tone="green">{t("s.sentOn", { d: s.sent_at.slice(0, 10) })}</Badge> : <Badge tone="amber">{t("s.notSent")}</Badge>}
          <a className="text-sm font-semibold text-cobalt hover:underline" href={`/api/statements/${s.id}/pdf`} target="_blank" rel="noreferrer">{t("common.pdf")}</a>
          <a className="text-sm font-semibold text-cobalt hover:underline" href={`/portal/${tenant.portal_token}`} target="_blank" rel="noreferrer">{t("common.portal")}</a>
          <Button variant="ghost" size="sm" disabled={sending || blocked} onClick={async () => { setSending(true); setErr(""); try { await api.send(s.id); onChange(); } catch (e) { setErr((e as Error).message); } setSending(false); }}>{sending ? <Spinner /> : null} {s.sent_at ? t("s.resend") : t("s.send")}</Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>{open ? t("s.hideLines") : t("s.showLines")}</Button>
        </div>
      </div>
      {err && <div className="px-6 pb-3 text-xs text-ember">{err}</div>}
      {s.balance_cents !== 0 && <div className="flex items-center gap-3 border-t border-line px-6 py-2 text-xs"><span className="text-mute">{t("s.th.payment")}</span><PaymentControl sid={s.id} balance={s.balance_cents} status={s.payment_status} paidAt={s.paid_at} note={s.payment_note} onChange={onChange} /></div>}
      {s.suggested_prepayment_cents > 0 && Math.abs(s.suggested_prepayment_cents - tenant.monthly_prepayment_cents) >= 500 && (
        <div className="num border-t border-line px-6 py-2 text-xs text-ink-soft">{t("s.suggest")}: <b><Money cents={s.suggested_prepayment_cents} /></b> <span className="text-mute">(<Money cents={tenant.monthly_prepayment_cents} /> {t("s.prepaid")})</span></div>
      )}
      {open && (
        <table className="w-full border-t border-line text-sm">
          <thead className="text-left text-xs text-mute"><tr><th className="px-6 py-2 font-medium">{t("s.th.cost")}</th><th className="px-6 py-2 font-medium">{t("s.th.calc")}</th><th className="px-6 py-2 text-right font-medium">{t("s.th.building")}</th><th className="px-6 py-2 text-right font-medium">{t("s.th.share")}</th></tr></thead>
          <tbody className="divide-y divide-line">
            {s.lines.map((l, i) => (
              <tr key={i}>
                <td className="px-6 py-2.5 align-top"><div className="font-medium">{t(`cat.${l.category}` as Key)}</div><div className="text-xs text-mute">{l.description} · {l.provider}</div></td>
                <td className="px-6 py-2.5 align-top text-xs"><div className="text-mute">{t(`key.${l.allocation_key}` as Key)}</div><div className="num mt-0.5 text-ink-soft">{l.formula}</div></td>
                <td className="num px-6 py-2.5 text-right align-top"><Money cents={l.total_cents} /></td>
                <td className="num px-6 py-2.5 text-right align-top font-semibold"><Money cents={l.share_cents} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/** Manual payment tracking: open → tenant paid / refund transferred. One control, used on Statements and Tenants. */
export function PaymentControl({ sid, balance, status, paidAt, note, onChange, compact }: { sid: number; balance: number; status: PaymentStatus; paidAt: string | null; note?: string | null; onChange: () => void; compact?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ paid_at: new Date().toISOString().slice(0, 10), amount: (Math.abs(balance) / 100).toFixed(2), note: note ?? "" });
  const target: PaymentStatus = balance > 0 ? "paid" : "refunded";
  const tone = status === "open" ? "amber" : status === "waived" ? "slate" : "green";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge tone={tone}>{t(`pay.${status}`)}{paidAt && status !== "open" ? ` · ${t("pay.on", { d: paidAt })}` : ""}</Badge>
      {status === "open"
        ? <Button size="sm" variant={compact ? "ghost" : "primary"} onClick={() => setOpen(true)}>{balance > 0 ? t("pay.mark.paid") : t("pay.mark.refunded")}</Button>
        : <Button size="sm" variant="ghost" onClick={async () => { await api.setPayment(sid, { status: "open" }); onChange(); }}>{t("pay.reopen")}</Button>}
      {open && (
        <Modal title={t("pay.title")} onClose={() => setOpen(false)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("pay.date")}><input className={inputCls} type="date" value={f.paid_at} onChange={(e) => setF({ ...f, paid_at: e.target.value })} /></Field>
            <Field label={t("pay.amount")}><input className={inputCls + " num"} type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <div className="col-span-2"><Field label={t("pay.note")}><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t("pay.note.ph")} /></Field></div>
          </div>
          <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={async () => { await api.setPayment(sid, { status: target, paid_at: f.paid_at, paid_cents: Math.round(Number(f.amount) * 100), note: f.note }); setOpen(false); onChange(); }}>{t("pay.save")}</Button></div>
        </Modal>
      )}
    </span>
  );
}
