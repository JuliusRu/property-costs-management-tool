import { useEffect, useRef, useState } from "react";
import { api, CATEGORIES, KEYS, type Extraction, type Invoice, type Property } from "../api";
import { Badge, Button, Card, Empty, Field, inputCls, Modal, Money, Notice, PageTitle, Spinner } from "../ui";
import { useT, type Key } from "../i18n";

const YEAR = new Date().getFullYear() - 1;

export default function Invoices({ property }: { property: Property }) {
  const t = useT();
  const [year, setYear] = useState(YEAR);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [review, setReview] = useState<{ extraction: Extraction; file_name: string; original: string } | null>(null);
  const [edit, setEdit] = useState<Invoice | null>(null);
  const [msg, setMsg] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.invoices(property.id, year).then(setInvoices);
  useEffect(() => { load(); }, [property.id, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = async () => {
    setSyncing(true); setMsg("");
    try {
      const r = await api.sync(property.id);
      setMsg(r.imported.length ? t("i.synced", { n: r.imported.length }) : t("i.uptodate"));
      if (r.errors.length) setMsg((m) => m + " " + t("i.errors") + r.errors.join("; "));
      await load();
    } catch (e) { setMsg((e as Error).message); }
    setSyncing(false);
  };

  const onFile = async (f: File) => {
    setExtracting(true); setMsg("");
    try { const r = await api.extract(property.id, f); setReview({ ...r, original: f.name }); }
    catch (e) { setMsg((e as Error).message); }
    setExtracting(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const allocable = invoices.reduce((s, i) => s + (i.allocable ? i.amount_cents - i.non_allocable_cents : 0), 0);
  const excluded = invoices.reduce((s, i) => s + (i.allocable ? i.non_allocable_cents : i.amount_cents), 0);

  return (
    <>
      <PageTitle title={t("i.title")} sub={t("i.sub")}
        right={
          <div className="flex items-center gap-2">
            <select className={inputCls + " w-auto"} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[YEAR + 1, YEAR, YEAR - 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={extracting}>{extracting ? <Spinner /> : null} {extracting ? t("i.reading") : t("i.upload")}</Button>
            <Button onClick={sync} disabled={syncing}>{syncing ? <Spinner /> : null} {syncing ? t("i.syncing") : t("i.sync")}</Button>
          </div>
        } />

      {msg && <Notice>{msg}</Notice>}

      {invoices.length === 0 ? (
        <Empty title={t("i.empty", { y: year })}>{t("i.empty.sub")}</Empty>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-left text-xs text-mute">
              <tr><th className="px-5 py-3 font-medium">{t("i.th.provider")}</th><th className="px-5 py-3 font-medium">{t("i.th.category")}</th><th className="px-5 py-3 font-medium">{t("i.th.period")}</th><th className="px-5 py-3 font-medium">{t("i.th.key")}</th><th className="px-5 py-3 font-medium">{t("i.th.source")}</th><th className="px-5 py-3 text-right font-medium">{t("i.th.amount")}</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invoices.map((i) => <Row key={i.id} inv={i} onEdit={() => setEdit(i)} onChange={load} />)}
            </tbody>
            <tfoot className="border-t border-line">
              <tr><td className="px-5 py-3 text-mute" colSpan={5}>{t("i.foot.excluded")}</td><td className="num px-5 py-3 text-right text-mute"><Money cents={excluded} /></td></tr>
              <tr className="font-bold"><td className="px-5 py-3" colSpan={5}>{t("i.foot.allocable")}</td><td className="num px-5 py-3 text-right"><Money cents={allocable} /></td></tr>
            </tfoot>
          </table>
        </Card>
      )}

      {review && <InvoiceForm title={t("i.review.title")} sub={t("i.review.sub", { f: review.original, p: (review.extraction.confidence * 100).toFixed(0) })} initial={review.extraction} onClose={() => setReview(null)} onSave={async (e) => {
        await api.createInvoice(property.id, { ...e, source: "upload", file_name: review.file_name, ai_confidence: e.confidence, ai_notes: e.notes } as never);
        setReview(null); await load();
      }} />}
      {edit && <InvoiceForm title={t("i.edit.title")} initial={{ ...edit, allocable: !!edit.allocable, description: edit.description ?? "", non_allocable_reason: edit.non_allocable_reason ?? "", confidence: edit.ai_confidence ?? 1, notes: edit.ai_notes ?? "" }} onClose={() => setEdit(null)} onDelete={async () => { await api.deleteInvoice(edit.id); setEdit(null); await load(); }} onSave={async (e) => {
        await api.updateInvoice(edit.id, e as never); setEdit(null); await load();
      }} />}
    </>
  );
}

function Row({ inv, onEdit, onChange }: { inv: Invoice; onEdit: () => void; onChange: () => void }) {
  const t = useT();
  const change = async (k: string) => { await api.updateInvoice(inv.id, { allocation_key: k }); onChange(); };
  const conf = inv.ai_confidence;
  const src = (["sync", "upload", "sample"].includes(inv.source) ? inv.source : "manual") as "sync" | "upload" | "sample" | "manual";
  const tone = { sync: "blue", upload: "green", sample: "amber", manual: "slate" } as const;
  return (
    <tr className={!inv.allocable ? "opacity-60" : ""}>
      <td className="px-5 py-3">
        <button className="text-left font-semibold hover:text-cobalt" onClick={onEdit}>{inv.provider}</button>
        <div className="text-xs text-mute">{inv.description}{inv.file_name && <> · <a className="underline" href={`/api/invoices/${inv.id}/file`} target="_blank" rel="noreferrer">PDF</a></>}</div>
        {inv.ai_notes && <div className="mt-1 text-xs text-[#8a5a00]">{inv.ai_notes}</div>}
      </td>
      <td className="px-5 py-3">{t(`cat.${inv.category}` as Key)}
        {!inv.allocable && <div className="mt-1"><Badge tone="red">{t("i.notAllocable")}</Badge></div>}
        {inv.allocable && inv.non_allocable_cents > 0 && <div className="mt-1 text-xs text-ember"><Money cents={inv.non_allocable_cents} /> {t("i.excluded")}{inv.non_allocable_reason ? ` — ${inv.non_allocable_reason}` : ""}</div>}
      </td>
      <td className="num whitespace-nowrap px-5 py-3 text-mute">{inv.period_start} – {inv.period_end}</td>
      <td className="px-5 py-3">
        <select className="max-w-[220px] rounded-md border border-line px-2 py-1 text-xs" value={inv.allocation_key} onChange={(e) => change(e.target.value)}>
          {KEYS.map((k) => <option key={k} value={k}>{t(`key.${k}`)}</option>)}
        </select>
      </td>
      <td className="px-5 py-3">
        <Badge tone={tone[src]}>{t(`i.src.${src}`)}</Badge>
        {conf != null && <div className="mt-1 text-xs text-mute">{t("i.confidence", { p: (conf * 100).toFixed(0) })}</div>}
      </td>
      <td className="num px-5 py-3 text-right font-semibold"><Money cents={inv.amount_cents} /></td>
    </tr>
  );
}

export function InvoiceForm({ title, sub, initial, onClose, onSave, onDelete }: { title: string; sub?: React.ReactNode; initial: Extraction; onClose: () => void; onSave: (e: Extraction) => Promise<void>; onDelete?: () => Promise<void> }) {
  const t = useT();
  const [e, setE] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Extraction>(k: K, v: Extraction[K]) => setE({ ...e, [k]: v });
  const allocablePart = e.allocable ? e.amount_cents - e.non_allocable_cents : 0;
  return (
    <Modal title={title} sub={sub} onClose={onClose}>
      {e.notes && <Notice>{e.notes}</Notice>}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("i.f.provider")}><input className={inputCls} value={e.provider} onChange={(ev) => set("provider", ev.target.value)} /></Field>
        <Field label={t("i.f.amount")}><input className={inputCls + " num"} type="number" step="0.01" value={(e.amount_cents / 100).toFixed(2)} onChange={(ev) => set("amount_cents", Math.round(Number(ev.target.value) * 100))} /></Field>
        <Field label={t("i.f.category")}><select className={inputCls} value={e.category} onChange={(ev) => set("category", ev.target.value)}>{CATEGORIES.map((k) => <option key={k} value={k}>{t(`cat.${k}`)}</option>)}</select></Field>
        <Field label={t("i.f.key")}><select className={inputCls} value={e.allocation_key} onChange={(ev) => set("allocation_key", ev.target.value)}>{KEYS.map((k) => <option key={k} value={k}>{t(`key.${k}`)}</option>)}</select></Field>
        <Field label={t("i.f.start")}><input className={inputCls} type="date" value={e.period_start} onChange={(ev) => set("period_start", ev.target.value)} /></Field>
        <Field label={t("i.f.end")}><input className={inputCls} type="date" value={e.period_end} onChange={(ev) => set("period_end", ev.target.value)} /></Field>
        <div className="col-span-2"><Field label={t("i.f.desc")}><input className={inputCls} value={e.description} onChange={(ev) => set("description", ev.target.value)} /></Field></div>
        {(e.category === "heating" || e.co2_cents > 0) && (
          <>
            <Field label={t("i.f.co2")} hint={t("i.f.co2.hint")}><input className={inputCls + " num"} type="number" step="0.01" min="0" value={(e.co2_cents / 100).toFixed(2)} onChange={(ev) => set("co2_cents", Math.max(0, Math.round(Number(ev.target.value) * 100)))} /></Field>
            <Field label={t("i.f.kwh")}><input className={inputCls + " num"} type="number" step="1" min="0" value={e.energy_kwh} onChange={(ev) => set("energy_kwh", Math.max(0, Number(ev.target.value)))} /></Field>
          </>
        )}
        <div className="col-span-2 rounded-lg bg-surface p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={e.allocable} onChange={(ev) => set("allocable", ev.target.checked)} /> {t("i.f.allocable")}</label>
          {e.allocable && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label={t("i.f.nonAlloc")} hint={t("i.f.nonAlloc.hint")}><input className={inputCls + " num"} type="number" step="0.01" min="0" value={(e.non_allocable_cents / 100).toFixed(2)} onChange={(ev) => set("non_allocable_cents", Math.max(0, Math.round(Number(ev.target.value) * 100)))} /></Field>
              <Field label={t("i.f.reason")}><input className={inputCls} value={e.non_allocable_reason} onChange={(ev) => set("non_allocable_reason", ev.target.value)} placeholder={t("i.f.reason.ph")} /></Field>
            </div>
          )}
          <div className="mt-2 text-sm">{t("i.f.distributed")} <b className="num"><Money cents={allocablePart} /></b></div>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between">
        {onDelete ? <Button variant="danger" size="sm" onClick={async () => { if (confirm(t("i.delete.confirm"))) await onDelete(); }}>{t("common.delete")}</Button> : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={saving || allocablePart < 0} onClick={async () => { setSaving(true); await onSave(e); setSaving(false); }}>{saving ? <Spinner /> : null} {onDelete ? t("common.save") : t("i.f.book")}</Button>
        </div>
      </div>
    </Modal>
  );
}
