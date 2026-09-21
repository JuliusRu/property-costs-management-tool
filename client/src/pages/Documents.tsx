import { useEffect, useMemo, useRef, useState } from "react";
import { api, DOC_KINDS, type Doc, type DocKind, type Property } from "../api";
import { Badge, Button, Card, Empty, Field, inputCls, Modal, Money, Notice, PageTitle, Spinner } from "../ui";
import { useT, type Key } from "../i18n";
import { InvoiceForm } from "./Invoices";

type SortKey = "title" | "kind" | "provider" | "doc_date" | "amount_cents" | "tenant_name" | "size_bytes";
type Group = "none" | "provider" | "year" | "kind";

const KIND_TONE: Record<DocKind, "slate" | "green" | "amber" | "red" | "blue"> = { invoice: "blue", contract: "green", notice: "amber", insurance: "slate", meter: "slate", correspondence: "slate", statement: "green", other: "slate" };

export default function Documents({ property }: { property: Property }) {
  const t = useT();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [provider, setProvider] = useState<string>("");
  const [group, setGroup] = useState<Group>("none");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "doc_date", dir: -1 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [edit, setEdit] = useState<Doc | null>(null);
  const [book, setBook] = useState<{ doc: Doc; extraction: Awaited<ReturnType<typeof api.extractFromDocument>> } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => api.documents(property.id).then(setDocs);
  useEffect(() => { load(); }, [property.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (f: File) => {
    setBusy(true); setMsg("");
    try { const d = await api.uploadDocument(property.id, f); await load(); setEdit({ ...d, url: `/api/documents/${d.id}/file`, source: "upload", tenant_name: null }); }
    catch (e) { setMsg((e as Error).message); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const years = useMemo(() => [...new Set(docs.map((d) => (d.doc_date ?? d.created_at).slice(0, 4)).filter(Boolean))].sort().reverse(), [docs]);
  const providers = useMemo(() => [...new Set(docs.map((d) => d.provider).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b)), [docs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = docs.filter((d) =>
      (!kind || d.kind === kind) &&
      (!year || (d.doc_date ?? d.created_at).startsWith(year)) &&
      (!provider || d.provider === provider) &&
      (!needle || [d.title, d.provider, d.notes, d.tenant_name].some((v) => v?.toLowerCase().includes(needle))));
    const val = (d: Doc) => { const v = d[sort.key]; return v == null ? (typeof d.amount_cents === "number" && sort.key === "amount_cents" ? 0 : "") : v; };
    return rows.sort((a, b) => { const x = val(a), y = val(b); const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }); return c * sort.dir; });
  }, [docs, q, kind, year, provider, sort]);

  const groups = useMemo(() => {
    if (group === "none") return [["", filtered] as [string, Doc[]]];
    const m = new Map<string, Doc[]>();
    for (const d of filtered) {
      const k = group === "provider" ? (d.provider ?? "—") : group === "year" ? (d.doc_date ?? d.created_at).slice(0, 4) : t(`d.kind.${d.kind}` as Key);
      m.set(k, [...(m.get(k) ?? []), d]);
    }
    return [...m.entries()].sort((a, b) => (group === "year" ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])));
  }, [filtered, group, t]);

  const th = (key: SortKey, label: string, right = false) => (
    <th className={`px-4 py-2.5 font-medium ${right ? "text-right" : "text-left"}`}>
      <button className={`inline-flex items-center gap-1 hover:text-ink ${sort.key === key ? "text-ink" : ""}`} onClick={() => setSort({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : key === "doc_date" || key === "amount_cents" ? -1 : 1 })}>
        {label}{sort.key === key && <span className="text-cobalt">{sort.dir === 1 ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
  const sizeStr = (n: number | null) => (n == null ? "—" : n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

  return (
    <>
      <PageTitle title={t("d.title")} sub={t("d.sub")}
        right={<><input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? <Spinner /> : null} {busy ? t("d.uploading") : t("d.upload")}</Button></>} />
      {msg && <Notice tone="red">{msg}</Notice>}

      {docs.length === 0 ? (
        <Empty title={t("d.empty")}>{t("d.empty.sub")}</Empty>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input className={inputCls + " max-w-xs"} placeholder={t("d.search")} value={q} onChange={(e) => setQ(e.target.value)} />
            <select className={inputCls + " !w-auto max-w-[200px]"} value={kind} onChange={(e) => setKind(e.target.value)}><option value="">{t("d.allKinds")}</option>{DOC_KINDS.map((k) => <option key={k} value={k}>{t(`d.kind.${k}`)}</option>)}</select>
            <select className={inputCls + " !w-auto"} value={year} onChange={(e) => setYear(e.target.value)}><option value="">{t("d.allYears")}</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            <select className={inputCls + " !w-auto max-w-[220px]"} value={provider} onChange={(e) => setProvider(e.target.value)}><option value="">{t("d.allProviders")}</option>{providers.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            <label className="ml-auto flex items-center gap-2 text-sm text-mute">{t("d.group")}
              <select className={inputCls + " !w-auto"} value={group} onChange={(e) => setGroup(e.target.value as Group)}>{(["none", "provider", "year", "kind"] as const).map((g) => <option key={g} value={g}>{t(`d.group.${g}`)}</option>)}</select>
            </label>
            <span className="text-xs text-mute">{t("d.count", { n: filtered.length })}</span>
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-xs text-mute">
                <tr>{th("title", t("d.th.title"))}{th("kind", t("d.th.kind"))}{th("provider", t("d.th.provider"))}{th("doc_date", t("d.th.date"))}{th("amount_cents", t("d.th.amount"), true)}{th("tenant_name", t("d.th.tenant"))}{th("size_bytes", t("d.th.size"), true)}<th /></tr>
              </thead>
              {groups.map(([g, rows]) => (
                <tbody key={g} className="divide-y divide-line border-t border-line">
                  {group !== "none" && <tr className="bg-surface"><td colSpan={8} className="px-4 py-1.5 text-xs font-semibold text-ink-soft">{g} <span className="font-normal text-mute">· {rows.length}</span></td></tr>}
                  {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-mute">{t("d.noMatch")}</td></tr>}
                  {rows.map((d) => (
                    <tr key={d.id} className="hover:bg-surface/60">
                      <td className="px-4 py-2.5">
                        <a className="font-semibold hover:text-cobalt" href={d.url} target="_blank" rel="noreferrer">{d.title}</a>
                        {d.notes && <div className="text-xs text-mute">{d.kind === "statement" ? t(d.notes === "sent" ? "d.sent" : "d.draft") : d.source !== "upload" && d.kind === "invoice" ? t(`cat.${d.notes}` as Key) : d.notes}</div>}
                      </td>
                      <td className="px-4 py-2.5"><Badge tone={KIND_TONE[d.kind]}>{t(`d.kind.${d.kind}` as Key)}</Badge>
                        {d.kind === "invoice" && d.source === "upload" && <div className="mt-1 text-xs">{d.invoice_id ? <span className="text-mint">{t("d.booked")}</span> : <span className="text-[#8a5a00]">{t("d.notBooked")}</span>}</div>}
                        {d.kind === "contract" && d.lease_confirmed === false && <div className="mt-1 text-xs text-ember">{t("lease.unconfirmed")}</div>}
                      </td>
                      <td className="px-4 py-2.5">{d.provider ?? "—"}</td>
                      <td className="num whitespace-nowrap px-4 py-2.5 text-mute">{d.doc_date ?? d.created_at.slice(0, 10)}</td>
                      <td className="num px-4 py-2.5 text-right">{d.amount_cents != null ? <Money cents={d.amount_cents} /> : "—"}</td>
                      <td className="px-4 py-2.5 text-mute">{d.tenant_name ?? "—"}</td>
                      <td className="num px-4 py-2.5 text-right text-mute">{sizeStr(d.size_bytes)}</td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {d.source === "upload" && d.kind === "invoice" && !d.invoice_id && <Button size="sm" variant="ghost" className="mr-1" onClick={async () => { setBusy(true); try { setBook({ doc: d, extraction: await api.extractFromDocument(Number(d.id)) }); } catch (e) { setMsg((e as Error).message); } setBusy(false); }}>{t("d.book")}</Button>}
                        {d.source === "upload" && <Button size="sm" variant="ghost" onClick={() => setEdit(d)}>✎</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </Card>
        </>
      )}

      {edit && <DocModal doc={edit} property={property} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await load(); }} />}
      {book && <InvoiceForm title={t("i.review.title")} sub={t("i.review.sub", { f: book.doc.title, p: (book.extraction.extraction.confidence * 100).toFixed(0) })} initial={book.extraction.extraction} onClose={() => setBook(null)} onSave={async (e) => {
        const inv = await api.createInvoice(property.id, { ...e, source: "upload", file_name: book.extraction.file_name, ai_confidence: e.confidence, ai_notes: e.notes } as never);
        await api.linkDocumentInvoice(Number(book.doc.id), inv.id);
        setBook(null); await load();
      }} />}
    </>
  );
}

function DocModal({ doc, property, onClose, onSaved }: { doc: Doc; property: Property; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState({ title: doc.title, kind: doc.kind, provider: doc.provider ?? "", doc_date: doc.doc_date ?? "", amount: doc.amount_cents == null ? "" : (doc.amount_cents / 100).toFixed(2), tenant_id: doc.tenant_id ? String(doc.tenant_id) : "", notes: doc.notes ?? "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={t("d.edit.title")} sub={doc.ai_confidence != null ? t("d.edit.sub", { p: Math.round(doc.ai_confidence * 100) }) : undefined} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label={t("d.f.title")}><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></Field></div>
        <Field label={t("d.f.kind")}><select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as DocKind })}>{DOC_KINDS.filter((k) => k !== "statement").map((k) => <option key={k} value={k}>{t(`d.kind.${k}`)}</option>)}</select></Field>
        <Field label={t("d.f.provider")}><input className={inputCls} value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} /></Field>
        <Field label={t("d.f.date")}><input className={inputCls} type="date" value={f.doc_date} onChange={(e) => setF({ ...f, doc_date: e.target.value })} /></Field>
        <Field label={t("d.f.amount")}><input className={inputCls + " num"} type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label={t("d.f.tenant")}><select className={inputCls} value={f.tenant_id} onChange={(e) => setF({ ...f, tenant_id: e.target.value })}><option value="">—</option>{property.tenants.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <div className="col-span-2"><Field label={t("d.f.notes")}><input className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        <div className="col-span-2 text-xs text-mute"><a className="text-cobalt underline" href={doc.url} target="_blank" rel="noreferrer">{t("d.open")}</a> · {doc.file_name}</div>
      </div>
      <div className="mt-5 flex items-center justify-between">
        <Button variant="danger" size="sm" onClick={async () => { if (confirm(t("d.delete.confirm"))) { await api.deleteDocument(Number(doc.id)); onSaved(); } }}>{t("common.delete")}</Button>
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={busy || !f.title} onClick={async () => { setBusy(true); await api.updateDocument(Number(doc.id), { title: f.title, kind: f.kind, provider: f.provider, doc_date: f.doc_date || null, amount_cents: f.amount === "" ? null : Math.round(Number(f.amount) * 100), tenant_id: f.tenant_id ? Number(f.tenant_id) : null, notes: f.notes } as never); onSaved(); }}>{busy ? <Spinner /> : null} {t("common.save")}</Button></div>
      </div>
    </Modal>
  );
}
