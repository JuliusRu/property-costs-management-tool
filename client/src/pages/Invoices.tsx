import { useEffect, useRef, useState } from "react";
import { api, CATEGORY_LABEL, KEY_LABEL, type Extraction, type Invoice, type Property } from "../api";
import { Badge, Button, Card, Field, inputCls, Money, PageTitle, Spinner } from "../ui";

const YEAR = new Date().getFullYear() - 1;

export default function Invoices({ property }: { property: Property }) {
  const [year, setYear] = useState(YEAR);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [review, setReview] = useState<{ extraction: Extraction; file_name: string; original: string } | null>(null);
  const [msg, setMsg] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.invoices(property.id, year).then(setInvoices);
  useEffect(() => { load(); }, [property.id, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = async () => {
    setSyncing(true); setMsg("");
    try {
      const r = await api.sync(property.id);
      setMsg(r.imported.length ? `Pulled ${r.imported.length} new invoice${r.imported.length > 1 ? "s" : ""} from providers.` : "Inbox is up to date — nothing new.");
      if (r.errors.length) setMsg((m) => m + " Errors: " + r.errors.join("; "));
      await load();
    } catch (e) { setMsg((e as Error).message); }
    setSyncing(false);
  };

  const onFile = async (f: File) => {
    setExtracting(true); setMsg("");
    try { const r = await api.extract(property.id, f); setReview({ ...r, original: f.name }); }
    catch (e) { setMsg((e as Error).message); }
    setExtracting(false);
  };

  const total = invoices.filter((i) => i.allocable).reduce((s, i) => s + i.amount_cents, 0);

  return (
    <>
      <PageTitle title="Invoices" sub="Everything the building cost this year — pulled from providers, read by AI, checked by you."
        right={
          <div className="flex items-center gap-2">
            <select className={inputCls + " w-auto"} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[YEAR + 1, YEAR, YEAR - 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={extracting}>{extracting ? <Spinner /> : null} Upload invoice</Button>
            <Button onClick={sync} disabled={syncing}>{syncing ? <Spinner /> : null} {syncing ? "Reading invoices…" : "Sync inbox"}</Button>
          </div>
        } />

      {msg && <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">{msg}</div>}

      <Card>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr><th className="px-5 py-2">Provider</th><th className="px-5 py-2">Category</th><th className="px-5 py-2">Period</th><th className="px-5 py-2">Allocation</th><th className="px-5 py-2">Source</th><th className="px-5 py-2 text-right">Amount</th><th className="px-2 py-2"></th></tr>
          </thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">No invoices for {year} yet. Click <b>Sync inbox</b> to pull them from your providers.</td></tr>}
            {invoices.map((i) => <Row key={i.id} inv={i} onChange={load} />)}
          </tbody>
          <tfoot><tr className="border-t border-slate-200 font-medium"><td className="px-5 py-3" colSpan={5}>Allocable total</td><td className="px-5 py-3 text-right"><Money cents={total} /></td><td /></tr></tfoot>
        </table>
      </Card>

      {review && <ReviewModal data={review} onClose={() => setReview(null)} onSave={async (e) => {
        await api.createInvoice(property.id, { ...e, allocable: e.allocable, source: "upload", file_name: review.file_name, ai_confidence: e.confidence, ai_notes: e.notes } as never);
        setReview(null); await load();
      }} />}
    </>
  );
}

function Row({ inv, onChange }: { inv: Invoice; onChange: () => void }) {
  const [key, setKey] = useState(inv.allocation_key);
  const change = async (k: string) => { setKey(k); await api.updateInvoice(inv.id, { allocation_key: k }); onChange(); };
  const conf = inv.ai_confidence;
  return (
    <tr className={`border-t border-slate-100 ${!inv.allocable ? "opacity-60" : ""}`}>
      <td className="px-5 py-3">
        <div className="font-medium">{inv.provider}</div>
        <div className="text-xs text-slate-500">{inv.description}{inv.file_name && <> · <a className="underline" href={`/api/invoices/${inv.id}/file`} target="_blank" rel="noreferrer">PDF</a></>}</div>
        {inv.ai_notes && <div className="mt-1 text-xs text-amber-700">⚠ {inv.ai_notes}</div>}
      </td>
      <td className="px-5 py-3">{CATEGORY_LABEL[inv.category] ?? inv.category}{!inv.allocable && <div><Badge tone="red">not allocable</Badge></div>}</td>
      <td className="px-5 py-3 text-slate-600">{inv.period_start} – {inv.period_end}</td>
      <td className="px-5 py-3">
        <select className="rounded-md border border-slate-200 px-2 py-1 text-xs" value={key} onChange={(e) => change(e.target.value)}>
          {Object.entries(KEY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </td>
      <td className="px-5 py-3">
        {inv.source === "sync" ? <Badge tone="blue">auto-pulled</Badge> : inv.source === "upload" ? <Badge tone="green">AI-read</Badge> : <Badge>manual</Badge>}
        {conf != null && <div className="mt-1 text-xs text-slate-500">confidence {(conf * 100).toFixed(0)} %</div>}
      </td>
      <td className="px-5 py-3 text-right"><Money cents={inv.amount_cents} /></td>
      <td className="px-2 py-3"><Button variant="danger" className="px-2 py-1" onClick={async () => { if (confirm("Delete invoice?")) { await api.deleteInvoice(inv.id); onChange(); } }}>✕</Button></td>
    </tr>
  );
}

function ReviewModal({ data, onClose, onSave }: { data: { extraction: Extraction; original: string }; onClose: () => void; onSave: (e: Extraction) => Promise<void> }) {
  const [e, setE] = useState(data.extraction);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Extraction>(k: K, v: Extraction[K]) => setE({ ...e, [k]: v });
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg p-6" >
        <div onClick={(ev) => ev.stopPropagation()}>
          <div className="mb-1 text-lg font-semibold">Review extracted invoice</div>
          <p className="mb-4 text-sm text-slate-500">AI read <b>{data.original}</b> with {(e.confidence * 100).toFixed(0)} % confidence. Correct anything before booking.</p>
          {e.notes && <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">⚠ {e.notes}</div>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider"><input className={inputCls} value={e.provider} onChange={(ev) => set("provider", ev.target.value)} /></Field>
            <Field label="Amount (€)"><input className={inputCls} type="number" step="0.01" value={(e.amount_cents / 100).toFixed(2)} onChange={(ev) => set("amount_cents", Math.round(Number(ev.target.value) * 100))} /></Field>
            <Field label="Category"><select className={inputCls} value={e.category} onChange={(ev) => set("category", ev.target.value)}>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Allocation key"><select className={inputCls} value={e.allocation_key} onChange={(ev) => set("allocation_key", ev.target.value)}>{Object.entries(KEY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Period start"><input className={inputCls} type="date" value={e.period_start} onChange={(ev) => set("period_start", ev.target.value)} /></Field>
            <Field label="Period end"><input className={inputCls} type="date" value={e.period_end} onChange={(ev) => set("period_end", ev.target.value)} /></Field>
            <div className="col-span-2"><Field label="Description"><input className={inputCls} value={e.description} onChange={(ev) => set("description", ev.target.value)} /></Field></div>
            <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={e.allocable} onChange={(ev) => set("allocable", ev.target.checked)} /> Allocable to tenants (§ 2 BetrKV)</label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={saving} onClick={async () => { setSaving(true); await onSave(e); setSaving(false); }}>{saving ? <Spinner /> : null} Book invoice</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
