import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useRef } from "react";
import { api, CATEGORIES, HEATING_TYPES, KEYS, type Extraction, type Invoice, type Lease, type LeaseExtraction, type Payment, type Property, type Settings, type Summary, type Tenant, type TenantRow, type Unit, type UnitType } from "../api";
import { InvoiceForm } from "./Invoices";
import { Badge, Button, Card, Field, inputCls, Modal, Money, Notice, PageTitle, Spinner } from "../ui";
import { useT, type Key } from "../i18n";
import { DataTable, type Column } from "../table";

const YEAR = new Date().getFullYear() - 1;
type OccRow = { unit: Unit; tenant: Tenant | null; first: boolean };

export default function Building({ property, onChange }: { property: Property; onChange: () => void }) {
  const t = useT();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [editUnit, setEditUnit] = useState<Partial<Unit> | null>(null);
  const [editTenant, setEditTenant] = useState<(Partial<Tenant> & { unit_id: number }) | null>(null);
  const [editProp, setEditProp] = useState(false);
  const [settings, setSettings] = useState(false);
  const [preview, setPreview] = useState<{ summary: Summary; units: { unit_id: number; tenants_cents: number; prepaid_cents: number; balance_cents: number }[] } | null>(null);
  const [addInv, setAddInv] = useState<Extraction | null>(null);
  const [editInv, setEditInv] = useState<Invoice | null>(null);
  const [review, setReview] = useState<{ positions: Extraction[]; index: number; file_name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const reloadCosts = () => Promise.all([api.invoices(property.id).then(setInvoices), api.preview(property.id, YEAR).then(setPreview).catch(() => setPreview(null))]);
  useEffect(() => { reloadCosts(); }, [property.id, property.units.length, property.tenants.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const blankInvoice = (): Extraction => ({ provider: "", category: "insurance", description: "", amount_cents: 0, period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`, allocation_key: "area", pool: "all", allocable: true, non_allocable_cents: 0, non_allocable_reason: "", co2_cents: 0, energy_kwh: 0, confidence: 1, notes: "" });
  const shareOf = (unitId: number) => preview?.units.find((u) => u.unit_id === unitId);
  const ownerShare = preview ? preview.summary.non_allocable_cents + preview.summary.owner_vacancy_cents + preview.summary.owner_lease_diff_cents : 0;

  const thisYear = invoices.filter((i) => i.period_start.startsWith(String(YEAR)));
  // one row per tenancy; a unit without tenants gets one "vacant" row
  const occRows: OccRow[] = property.units.flatMap((u): OccRow[] => { const ts = property.tenants.filter((x) => x.unit_id === u.id); return ts.length ? ts.map((x, i) => ({ unit: u, tenant: x, first: i === 0 })) : [{ unit: u, tenant: null, first: true }]; });
  const total = thisYear.filter((i) => i.allocable).reduce((s, i) => s + i.amount_cents - i.non_allocable_cents, 0);
  const totalArea = property.units.reduce((s, u) => s + u.area_sqm, 0);

  return (
    <>
      <PageTitle title={property.name} sub={property.address}
        right={<div className="flex gap-2"><Button variant="ghost" onClick={() => setSettings(true)}>{t("b.settings")}</Button><Button variant="ghost" onClick={() => setEditProp(true)}>{t("b.edit")}</Button><Button onClick={() => setEditUnit({})}>{t("b.addUnit")}</Button></div>} />

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label={t("b.units")} value={String(property.units.length)} sub={t("b.total", { n: totalArea })} />
        <Stat label={t("b.invoices", { y: YEAR })} value={String(thisYear.length)} sub={t("b.readByAi", { n: thisYear.filter((i) => i.source !== "manual").length })} />
        <Stat label={t("b.allocable", { y: YEAR })} value={<Money cents={total} />} sub={t("b.whole")} />
        <Stat label={t("b.stat.owner", { y: YEAR })} value={<Money cents={ownerShare} />} sub={t("b.stat.owner.sub")} />
        <Stat label={t("b.heat")} value={<span className="text-base">{property.settings.heating_type === "decentral" ? t(`set.heating.decentral` as Key).split(" — ")[0] : (t(`set.heating.${property.settings.heating_type}` as Key).split(" — ")[1] ?? "").split(" (")[0]}</span>} sub={property.settings.heating_type === "decentral" ? "—" : property.settings.heizkv_exempt ? "§ 11 HeizkostenV" : `${Math.round(property.settings.consumption_share * 100)} % kWh / ${100 - Math.round(property.settings.consumption_share * 100)} % m²`} />
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="font-semibold">{t("b.occupancy", { y: YEAR })} <span className="font-normal text-mute">· {t("b.occupied", { n: property.units.filter((u) => property.tenants.some((x) => x.unit_id === u.id)).length, m: property.units.length })}</span></div>
          <div className="flex items-center gap-4 text-xs text-mute"><span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm bg-cobalt" />{t("b.legend.tenant")}</span><span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm bg-sun" />{t("b.legend.vacant")}</span></div>
        </div>
        <DataTable<OccRow> rows={occRows} rowKey={(r) => `${r.unit.id}-${r.tenant?.id ?? "v"}`} minWidth={900} defaultSort={{ key: "unit", dir: 1 }} emptyText={t("b.noUnits")} rowClass={(r) => (!r.tenant ? "bg-sun-soft/40" : "")}
          columns={[
            { key: "unit", label: t("b.th.unit"), width: "18%", sort: (r) => r.unit.label, render: (r) => <><button className="whitespace-nowrap text-left font-semibold hover:text-cobalt" onClick={() => setEditUnit(r.unit)}>{r.unit.label}</button> {r.unit.unit_type !== "residential" && <Badge>{t(`unit.${r.unit.unit_type}` as Key)}</Badge>}<div className="text-xs text-mute">{r.unit.area_sqm} m² · {r.unit.persons} {r.unit.persons === 1 ? t("common.person") : t("common.persons")}{r.unit.mea > 0 && <> · {r.unit.mea.toLocaleString("de-DE", { minimumFractionDigits: 3 })} MEA</>}</div><div className="text-xs text-mute">{r.unit.heating_kwh.toLocaleString("de-DE")} kWh · {r.unit.water_m3} m³</div></> },
            { key: "tenant", label: t("b.th.tenant"), sort: (r) => r.tenant?.name ?? "", render: (r) => r.tenant ? <><button className="font-medium hover:text-cobalt" onClick={() => setEditTenant(r.tenant!)}>{r.tenant.name}</button><div className="text-xs text-mute">{r.tenant.email}</div><div className="mt-1 flex flex-wrap gap-1">{hasRules(r.tenant.lease) && <Badge tone={r.tenant.lease.confirmed ? "green" : "red"}>{r.tenant.lease.confirmed ? t("lease.confirmed") : t("lease.unconfirmed")}</Badge>}<Badge tone={r.tenant.registered ? "green" : "slate"}>{r.tenant.registered ? t("b.tenant.registered") : t("b.tenant.notRegistered")}</Badge></div></> : <Badge tone="amber">{t("b.vacant")}</Badge> },
            { key: "period", label: t("b.th.period"), sort: (r) => r.tenant?.move_in ?? "", nowrap: true, render: (r) => <span className="num text-xs text-mute">{r.tenant ? <>{r.tenant.move_in ? t("tn.since", { d: r.tenant.move_in }) : "—"}{r.tenant.move_out && <div>{t("tn.until", { d: r.tenant.move_out })}</div>}</> : "—"}</span> },
            { key: "prepay", label: t("b.th.prepay"), align: "right", sort: (r) => r.tenant?.monthly_prepayment_cents ?? null, render: (r) => r.tenant ? <><Money cents={r.tenant.monthly_prepayment_cents} /><span className="text-xs text-mute">/{t("common.month")}</span></> : "—" },
            { key: "share", label: t("b.th.share", { y: YEAR }), align: "right", sort: (r) => shareOf(r.unit.id)?.tenants_cents ?? null, render: (r) => { const sh = shareOf(r.unit.id); return r.tenant && sh ? <><Money cents={sh.tenants_cents} /><div className="text-xs"><Money cents={sh.balance_cents} signed /></div></> : <span className="text-mute">—</span>; } },
            { key: "occ", label: t("b.th.occupancy", { y: YEAR }), width: "22%", render: (r) => <OccupancyBar tenants={r.tenant ? [r.tenant] : []} year={YEAR} /> },
            { key: "actions", label: "", align: "right", nowrap: true, render: (r) => r.first ? <Button size="sm" variant="ghost" onClick={() => setEditTenant({ unit_id: r.unit.id })}>{t("b.addTenant")}</Button> : null },
          ] satisfies Column<OccRow>[]} />
      </Card>

      <Card className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div><div className="font-semibold">{t("b.costs.h", { y: YEAR })}</div><div className="text-xs text-mute">{t("b.costs.sub")}</div></div>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setBusy(true); try { const r = await api.extract(property.id, f); setReview({ positions: r.positions, index: 0, file_name: r.file_name }); } catch (err) { alert((err as Error).message); } setBusy(false); e.target.value = ""; }} />
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Spinner /> : null} {t("b.costs.upload")}</Button>
            <Button size="sm" onClick={() => setAddInv(blankInvoice())}>{t("b.costs.add")}</Button>
          </div>
        </div>
        <DataTable<Invoice> rows={thisYear} rowKey={(i) => i.id} minWidth={820} defaultSort={{ key: "category", dir: 1 }} dense emptyText={t("b.costs.empty", { y: YEAR })} rowClass={(i) => (!i.allocable ? "opacity-60" : "")}
          columns={[
            { key: "provider", label: t("i.th.provider"), sort: (i) => i.provider, render: (i) => <><button className="text-left font-semibold hover:text-cobalt" onClick={() => setEditInv(i)}>{i.provider}</button><div className="text-xs text-mute">{i.description}</div></> },
            { key: "category", label: t("i.th.category"), sort: (i) => t(`cat.${i.category}` as Key), render: (i) => t(`cat.${i.category}` as Key) },
            { key: "scope", label: t("i.th.scope"), sort: (i) => (i.unit_id ? property.units.find((u) => u.id === i.unit_id)?.label ?? "" : ""), render: (i) => i.unit_id ? <Badge tone="blue">{t("i.scope.unit", { l: property.units.find((u) => u.id === i.unit_id)?.label ?? "" })}</Badge> : <span className="text-mute">{t("i.scope.building")}</span> },
            { key: "key", label: t("i.th.key"), sort: (i) => t(`key.${i.allocation_key}` as Key), render: (i) => <>{i.unit_id ? "—" : t(`key.${i.allocation_key}` as Key)}{!i.unit_id && i.pool !== "all" && <div className="text-xs text-cobalt-deep">{t(`pool.${i.pool}` as Key)}</div>}</> },
            { key: "amount", label: t("i.th.amount"), align: "right", sort: (i) => i.amount_cents, render: (i) => <span className="font-semibold"><Money cents={i.amount_cents} /></span> },
          ] satisfies Column<Invoice>[]}
          footer={<tr className="font-bold"><td className="px-4 py-3" colSpan={4}>{t("i.foot.allocable")}</td><td className="num px-4 py-3 text-right"><Money cents={total} /></td></tr>} />
        <div className="border-t border-line px-4 py-2 text-xs"><Link to="/app/invoices" className="font-semibold text-cobalt hover:underline">{t("b.costs.all")} →</Link></div>
      </Card>

      {addInv && <InvoiceForm units={property.units} title={t("i.f.manual.title")} initial={addInv} onClose={() => setAddInv(null)} onSave={async (e) => { await api.createInvoice(property.id, { ...e, source: "manual" } as never); setAddInv(null); await reloadCosts(); }} />}
      {editInv && <InvoiceForm units={property.units} title={t("i.edit.title")} initial={{ ...editInv, allocable: !!editInv.allocable, description: editInv.description ?? "", non_allocable_reason: editInv.non_allocable_reason ?? "", confidence: editInv.ai_confidence ?? 1, notes: editInv.ai_notes ?? "" }} onClose={() => setEditInv(null)} onDelete={async () => { await api.deleteInvoice(editInv.id); setEditInv(null); await reloadCosts(); }} onSave={async (e) => { await api.updateInvoice(editInv.id, e as never); setEditInv(null); await reloadCosts(); }} />}
      {review && (() => { const cur = review.positions[review.index]; const next = async () => { if (review.index + 1 < review.positions.length) setReview({ ...review, index: review.index + 1 }); else setReview(null); await reloadCosts(); };
        return <InvoiceForm key={review.index} units={property.units} title={t("i.review.title")} sub={review.positions.length > 1 ? t("i.review.multi", { i: review.index + 1, n: review.positions.length, f: "" }) : undefined} initial={cur} onClose={() => setReview(null)} onSkip={review.positions.length > 1 ? next : undefined}
          onSave={async (e) => { await api.createInvoice(property.id, { ...e, source: "upload", file_name: review.file_name, ai_confidence: e.confidence, ai_notes: e.notes } as never); await next(); }} />; })()}

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Link to="/app/invoices" className="rounded-[var(--radius-card)] border border-line bg-paper p-5 transition-colors hover:border-cobalt">
          <div className="font-semibold">{t("b.next1")}</div>
          <div className="mt-1 text-sm text-mute">{t("b.next1.sub")}</div>
        </Link>
        <Link to="/app/statements" className="rounded-[var(--radius-card)] border border-line bg-paper p-5 transition-colors hover:border-cobalt">
          <div className="font-semibold">{t("b.next2")}</div>
          <div className="mt-1 text-sm text-mute">{t("b.next2.sub")}</div>
        </Link>
      </div>

      {editProp && <PropertyModal property={property} onClose={() => setEditProp(false)} onSaved={() => { setEditProp(false); onChange(); }} />}
      {settings && <SettingsModal property={property} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); onChange(); }} />}
      {editUnit && <UnitModal unit={editUnit} propertyId={property.id} onClose={() => setEditUnit(null)} onSaved={() => { setEditUnit(null); onChange(); }} />}
      {editTenant && <TenantModal tenant={editTenant} onClose={() => setEditTenant(null)} onSaved={() => { setEditTenant(null); onChange(); }} />}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-mute">{label}</div>
      <div className="display num mt-1 text-2xl">{value}</div>
      {sub && <div className="mt-1 text-xs text-mute">{sub}</div>}
    </Card>
  );
}

/** 12-month strip: cobalt where a tenant lives, sun where the unit is vacant (that cost stays with the owner). */
function OccupancyBar({ tenants, year }: { tenants: Tenant[]; year: number }) {
  const months = Array.from({ length: 12 }, (_, m) => {
    const start = `${year}-${String(m + 1).padStart(2, "0")}-01`;
    const end = `${year}-${String(m + 1).padStart(2, "0")}-28`;
    return tenants.find((x) => (!x.move_in || x.move_in <= end) && (!x.move_out || x.move_out >= start));
  });
  return (
    <div>
      <div className="flex gap-0.5">
        {months.map((x, i) => <div key={i} title={x ? x.name : "vacant"} className={`h-3 flex-1 rounded-sm ${x ? "bg-cobalt" : "bg-sun"}`} />)}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-mute"><span>Jan</span><span>Dez {year}</span></div>
    </div>
  );
}

function PropertyModal({ property, onClose, onSaved }: { property: Property; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState({ name: property.name, address: property.address });
  return (
    <Modal title={t("b.prop.title")} onClose={onClose}>
      <div className="space-y-3">
        <Field label={t("b.prop.name")}><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t("b.prop.address")}><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      </div>
      <div className="mt-5 flex items-center justify-between">
        <Button variant="danger" size="sm" onClick={async () => { if (confirm(t("b.deleteBuilding.confirm"))) { try { await api.deleteProperty(property.id); try { localStorage.removeItem("property"); } catch { /* ignore */ } onSaved(); } catch (e) { alert((e as Error).message); } } }}>{t("b.deleteBuilding")}</Button>
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button onClick={async () => { await api.updateProperty(property.id, f); onSaved(); }}>{t("common.save")}</Button></div>
      </div>
    </Modal>
  );
}

function SettingsModal({ property, onClose, onSaved }: { property: Property; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState<Settings>({ ...property.settings });
  const central = f.heating_type !== "decentral";
  return (
    <Modal title={t("set.title")} sub={t("set.sub")} onClose={onClose}>
      <div className="space-y-4">
        <Field label={t("set.heating")} hint={t("set.heating.hint")}>
          <select className={inputCls} value={f.heating_type} onChange={(e) => setF({ ...f, heating_type: e.target.value as Settings["heating_type"] })}>
            {HEATING_TYPES.map((h) => <option key={h} value={h}>{t(`set.heating.${h}` as Key)}</option>)}
          </select>
        </Field>
        {central && !f.heizkv_exempt && (
          <Field label={t("set.share")} hint={t("set.share.hint")}>
            <div className="flex items-center gap-3"><input type="range" min="50" max="70" step="5" value={Math.round(f.consumption_share * 100)} onChange={(e) => setF({ ...f, consumption_share: Number(e.target.value) / 100 })} className="flex-1 accent-cobalt" /><span className="num w-12 text-right font-semibold">{Math.round(f.consumption_share * 100)} %</span></div>
          </Field>
        )}
        {central && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.hot_water_central} onChange={(e) => setF({ ...f, hot_water_central: e.target.checked })} /> {t("set.hotwater")}</label>}
        {central && <div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.heizkv_exempt} onChange={(e) => setF({ ...f, heizkv_exempt: e.target.checked })} /> {t("set.exempt")}</label><div className="ml-6 text-xs text-mute">{t("set.exempt.hint")}</div></div>}
        {central && <Field label={t("set.area")} hint={t("set.area.hint")}><input className={inputCls} type="number" value={f.heated_area_sqm ?? ""} onChange={(e) => setF({ ...f, heated_area_sqm: e.target.value === "" ? null : Number(e.target.value) })} placeholder={String(property.units.filter((u) => u.unit_type !== "garage").reduce((s, u) => s + u.area_sqm, 0))} /></Field>}
      </div>
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button onClick={async () => { await api.updateSettings(property.id, f); onSaved(); }}>{t("common.save")}</Button></div>
    </Modal>
  );
}

function hasRules(l: Lease | undefined): boolean {
  return !!l && (Object.keys(l.key_overrides ?? {}).length > 0 || (l.excluded_categories ?? []).length > 0 || l.prepayment_type === "pauschale");
}

function UnitModal({ unit, propertyId, onClose, onSaved }: { unit: Partial<Unit>; propertyId: number; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState({ label: unit.label ?? "", unit_type: (unit.unit_type ?? "residential") as UnitType, area_sqm: unit.area_sqm ?? 0, mea: unit.mea ?? 0, persons: unit.persons ?? 1, heating_kwh: unit.heating_kwh ?? 0, water_m3: unit.water_m3 ?? 0 });
  const [busy, setBusy] = useState(false);
  const n = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === "label" ? e.target.value : Number(e.target.value) });
  return (
    <Modal title={unit.id ? t("b.unit.title", { l: unit.label ?? "" }) : t("b.unit.new")} sub={t("b.unit.sub")} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("b.unit.label")}><input className={inputCls} value={f.label} onChange={n("label")} placeholder={t("b.unit.label.ph")} autoFocus /></Field>
        <Field label={t("b.unit.type")} hint={t("b.unit.type.hint")}><select className={inputCls} value={f.unit_type} onChange={(e) => setF({ ...f, unit_type: e.target.value as UnitType })}>{(["residential", "commercial", "garage"] as const).map((k) => <option key={k} value={k}>{t(`unit.${k}`)}</option>)}</select></Field>
        <Field label={t("b.unit.area")}><input className={inputCls} type="number" step="0.1" value={f.area_sqm} onChange={n("area_sqm")} /></Field>
        <Field label={t("b.unit.mea")} hint={t("b.unit.mea.hint")}><input className={inputCls} type="number" step="0.001" value={f.mea} onChange={n("mea")} /></Field>
        <Field label={t("b.unit.persons")}><input className={inputCls} type="number" value={f.persons} onChange={n("persons")} /></Field>
        <Field label={t("b.unit.heating")}><input className={inputCls} type="number" value={f.heating_kwh} onChange={n("heating_kwh")} /></Field>
        <Field label={t("b.unit.water")}><input className={inputCls} type="number" step="0.1" value={f.water_m3} onChange={n("water_m3")} /></Field>
      </div>
      <div className="mt-5 flex items-center justify-between">
        {unit.id ? <Button variant="danger" size="sm" onClick={async () => { if (confirm(t("b.unit.delete.confirm"))) { await api.deleteUnit(unit.id!); onSaved(); } }}>{t("b.unit.delete")}</Button> : <span />}
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={busy || !f.label} onClick={async () => { setBusy(true); if (unit.id) await api.updateUnit(unit.id, f); else await api.createUnit(propertyId, f); onSaved(); }}>{busy ? <Spinner /> : null} {t("common.save")}</Button></div>
      </div>
    </Modal>
  );
}

function TenantModal({ tenant, onClose, onSaved }: { tenant: Partial<Tenant> & { unit_id: number }; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState({ name: tenant.name ?? "", email: tenant.email ?? "", prepay: (tenant.monthly_prepayment_cents ?? 0) / 100, move_in: tenant.move_in ?? "", move_out: tenant.move_out ?? "" });
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(tenant.access_code ?? "");
  const [registered, setRegistered] = useState(!!tenant.registered);
  const [existing, setExisting] = useState<TenantRow[]>([]);
  useEffect(() => { if (!tenant.id) api.tenantsAll().then(setExisting).catch(() => {}); }, [tenant.id]);
  const body = () => ({ name: f.name, email: f.email, monthly_prepayment_cents: Math.round(f.prepay * 100), move_in: f.move_in || null, move_out: f.move_out || null });
  return (
    <Modal title={tenant.id ? tenant.name! : t("b.tenant.new")} sub={t("b.tenant.sub")} onClose={onClose} wide={!!tenant.id}>
      {!tenant.id && existing.length > 0 && (
        <div className="mb-4"><Field label={t("b.tenant.existing")} hint={t("b.tenant.existing.hint")}>
          <select className={inputCls} defaultValue="" onChange={(e) => { const r = existing.find((x) => String(x.id) === e.target.value); if (r) setF({ ...f, name: r.name, email: r.email, prepay: r.monthly_prepayment_cents / 100 }); }}>
            <option value="">{t("b.tenant.existing.none")}</option>
            {existing.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.property_name}, {r.unit_label}</option>)}
          </select>
        </Field></div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("b.tenant.name")}><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label={t("b.tenant.email")}><input className={inputCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={t("b.tenant.prepay")}><input className={inputCls} type="number" step="1" value={f.prepay} onChange={(e) => setF({ ...f, prepay: Number(e.target.value) })} /></Field>
        {tenant.id ? <Field label={t("b.tenant.code")} hint={t("b.tenant.code.hint")}>
          <div className="flex items-center gap-2">
            <div className="num flex-1 rounded-lg bg-surface px-3 py-2 font-mono text-sm font-bold tracking-widest">{code}</div>
            <Badge tone={registered ? "green" : "amber"}>{registered ? t("b.tenant.registered") : t("b.tenant.notRegistered")}</Badge>
            <Button size="sm" variant="ghost" onClick={async () => { if (confirm(t("b.tenant.resetAccess.confirm"))) { const r = await api.resetAccess(tenant.id!); setCode(r.access_code); setRegistered(false); } }}>{t("b.tenant.resetAccess")}</Button>
          </div>
        </Field> : <div />}
        <Field label={t("b.tenant.moveIn")} hint={t("b.tenant.moveIn.hint")}><input className={inputCls} type="date" value={f.move_in} onChange={(e) => setF({ ...f, move_in: e.target.value })} /></Field>
        <Field label={t("b.tenant.moveOut")} hint={t("b.tenant.moveOut.hint")}><input className={inputCls} type="date" value={f.move_out} onChange={(e) => setF({ ...f, move_out: e.target.value })} /></Field>
      </div>
      {tenant.id && <PaymentsSection tenant={tenant as Tenant} />}
      {tenant.id && <LeaseSection tenant={tenant as Tenant} onApply={(ext) => setF({ ...f, move_in: ext.move_in ?? f.move_in, prepay: ext.monthly_prepayment_cents ? ext.monthly_prepayment_cents / 100 : f.prepay })} />}
      <div className="mt-5 flex items-center justify-between">
        {tenant.id ? <Button variant="danger" size="sm" onClick={async () => { if (confirm(t("b.tenant.remove.confirm"))) { await api.deleteTenant(tenant.id!); onSaved(); } }}>{t("b.tenant.remove")}</Button> : <span />}
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={busy || !f.name || !f.email} onClick={async () => { setBusy(true); if (tenant.id) await api.updateTenant(tenant.id, body()); else await api.createTenant(tenant.unit_id, body()); onSaved(); }}>{busy ? <Spinner /> : null} {t("common.save")}</Button></div>
      </div>
    </Modal>
  );
}

/** Lease rules: upload → AI proposal with verbatim clauses → landlord edits and confirms. */
function LeaseSection({ tenant, onApply }: { tenant: Tenant; onApply: (e: LeaseExtraction) => void }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<(LeaseExtraction & { source_file: string | null }) | null>(null);
  const [saved, setSaved] = useState<Lease>(tenant.lease);
  const [apply, setApply] = useState(true);

  const read = async (fn: () => Promise<{ extraction: LeaseExtraction; file_name: string }>) => {
    setBusy(true); setErr("");
    try { const r = await fn(); setDraft({ ...r.extraction, source_file: r.file_name, confirmed: false }); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const confirm_ = async () => {
    if (!draft) return;
    const rules: Lease = { prepayment_type: draft.prepayment_type, key_overrides: draft.key_overrides, excluded_categories: draft.excluded_categories, clauses: draft.clauses, source_file: draft.source_file, confirmed: true };
    const r = await api.saveLease(tenant.id, rules);
    if (apply) onApply(draft);
    setSaved(r); setDraft(null);
  };
  const remove = async () => {
    const r = await api.saveLease(tenant.id, { prepayment_type: "vorauszahlung", key_overrides: {}, excluded_categories: [], clauses: [], source_file: saved.source_file, confirmed: false });
    setSaved(r);
  };
  const setOverride = (cat: string, key: string) => { if (!draft) return; const o = { ...draft.key_overrides }; if (key === "") delete o[cat]; else o[cat] = key; setDraft({ ...draft, key_overrides: o }); };
  const rules = draft ?? saved;
  const has = hasRules(saved);

  return (
    <div className="mt-5 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><div className="font-semibold">{t("lease.title")}</div><div className="text-xs text-mute">{t("lease.sub")}</div></div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && read(() => api.extractLease(tenant.id, e.target.files![0]))} />
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => read(() => api.sampleLease(tenant.id))}>{t("lease.sample")}</Button>
          <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Spinner /> : null} {busy ? t("lease.reading") : t("lease.upload")}</Button>
        </div>
      </div>
      {err && <p className="mt-2 text-sm text-ember">{err}</p>}

      {!draft && !has && <p className="mt-3 text-sm text-mute">{t("lease.none")}</p>}

      {(draft || has) && (
        <div className="mt-4 space-y-4 text-sm">
          {draft && (
            <>
              {draft.notes && <Notice>{draft.notes}</Notice>}
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-paper p-3 md:grid-cols-4">
                <div><div className="text-xs text-mute">{t("lease.tenant")}</div><div className="font-medium">{draft.tenant_name || "—"}</div></div>
                <div><div className="text-xs text-mute">{t("lease.unit")}</div><div className="font-medium">{draft.unit_hint || "—"}</div></div>
                <div><div className="text-xs text-mute">{t("lease.moveIn")}</div><div className="num font-medium">{draft.move_in ?? "—"}</div></div>
                <div><div className="text-xs text-mute">{t("lease.prepay")}</div><div className="num font-medium"><Money cents={draft.monthly_prepayment_cents} />/{t("common.month")}</div></div>
              </div>
            </>
          )}
          <div>
            <select className={inputCls} disabled={!draft} value={rules.prepayment_type} onChange={(e) => draft && setDraft({ ...draft, prepayment_type: e.target.value as Lease["prepayment_type"] })}>
              <option value="vorauszahlung">{t("lease.type.vorauszahlung")}</option><option value="pauschale">{t("lease.type.pauschale")}</option>
            </select>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-ink-soft">{t("lease.overrides")}</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(rules.key_overrides).map(([c, k]) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-1 text-xs">
                  {t(`cat.${c}` as Key)}: <b>{t(`key.${k}` as Key)}</b>
                  {draft && <button className="ml-1 text-mute hover:text-ember" onClick={() => setOverride(c, "")}>✕</button>}
                </span>
              ))}
              {draft && (
                <select className="rounded-md border border-line bg-paper px-2 py-1 text-xs" value="" onChange={(e) => { const [c, k] = e.target.value.split("|"); if (c) setOverride(c, k); }}>
                  <option value="">{t("lease.addOverride")}</option>
                  {CATEGORIES.map((c) => KEYS.map((k) => <option key={`${c}|${k}`} value={`${c}|${k}`}>{t(`cat.${c}`)} → {t(`key.${k}`)}</option>))}
                </select>
              )}
              {Object.keys(rules.key_overrides).length === 0 && <span className="text-xs text-mute">{t("lease.default")}</span>}
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-ink-soft">{t("lease.excluded")}</div>
            <div className="flex flex-wrap gap-2">
              {rules.excluded_categories.map((c) => <span key={c} className="inline-flex items-center gap-1 rounded-md border border-line bg-paper px-2 py-1 text-xs">{t(`cat.${c}` as Key)}{draft && <button className="ml-1 text-mute hover:text-ember" onClick={() => setDraft({ ...draft, excluded_categories: draft.excluded_categories.filter((x) => x !== c) })}>✕</button>}</span>)}
              {draft && <select className="rounded-md border border-line bg-paper px-2 py-1 text-xs" value="" onChange={(e) => e.target.value && setDraft({ ...draft, excluded_categories: [...new Set([...draft.excluded_categories, e.target.value])] })}><option value="">+</option>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}</select>}
              {rules.excluded_categories.length === 0 && <span className="text-xs text-mute">—</span>}
            </div>
          </div>
          {rules.clauses.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-ink-soft">{t("lease.clauses")}{saved.source_file && !draft && <> · <a className="text-cobalt underline" href={`/api/tenants/${tenant.id}/lease/file`} target="_blank" rel="noreferrer">{t("lease.file")}</a></>}</div>
              <ul className="space-y-2">
                {rules.clauses.map((c, i) => <li key={i} className="rounded-md border-l-2 border-cobalt bg-paper px-3 py-2"><div className="text-xs font-semibold">{c.topic}{c.page != null && <span className="font-normal text-mute"> · {t("lease.page", { n: c.page })}</span>}</div><div className="mt-0.5 text-xs italic text-ink-soft">„{c.quote}“</div></li>)}
              </ul>
            </div>
          )}
          {draft ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} /> {t("lease.apply")}</label>
              <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setDraft(null)}>{t("common.cancel")}</Button><Button size="sm" onClick={confirm_}>{t("lease.confirm")}</Button></div>
            </div>
          ) : (
            <div className="flex items-center justify-between"><Badge tone={saved.confirmed ? "green" : "red"}>{saved.confirmed ? t("lease.confirmed") : t("lease.unconfirmed")}</Badge><Button size="sm" variant="danger" onClick={remove}>{t("lease.remove")}</Button></div>
          )}
        </div>
      )}
    </div>
  );
}

/** Prepayments actually received in the statement year. Without entries the statement assumes monthly amount × months. */
function PaymentsSection({ tenant }: { tenant: Tenant }) {
  const t = useT();
  const [list, setList] = useState<Payment[]>([]);
  const [f, setF] = useState({ paid_on: `${YEAR}-01-01`, amount: (tenant.monthly_prepayment_cents / 100).toFixed(2), note: "" });
  const load = () => api.payments(tenant.id).then(setList);
  useEffect(() => { load(); }, [tenant.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const year = list.filter((p) => p.paid_on.startsWith(String(YEAR)));
  const sum = year.reduce((s, p) => s + p.amount_cents, 0);
  const months = (() => { const s = tenant.move_in && tenant.move_in > `${YEAR}-01-01` ? Number(tenant.move_in.slice(5, 7)) : 1; const e = tenant.move_out && tenant.move_out < `${YEAR}-12-31` ? Number(tenant.move_out.slice(5, 7)) : 12; return Math.max(0, e - s + 1); })();
  return (
    <div className="mt-5 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><div className="font-semibold">{t("pay.received.h", { y: YEAR })}</div><div className="text-xs text-mute">{t("pay.received.sub")}</div></div>
        {year.length === 0 && <Button size="sm" variant="ghost" onClick={async () => { await api.fillYear(tenant.id, YEAR); load(); }}>{t("pay.received.fill", { y: YEAR })}</Button>}
      </div>
      {year.length === 0 ? <p className="mt-3 text-sm text-mute">{t("pay.received.none", { n: months, a: (tenant.monthly_prepayment_cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" }) })}</p> : (
        <table className="mt-3 w-full text-sm">
          <tbody className="divide-y divide-line">
            {year.map((p) => <tr key={p.id}><td className="num py-1.5 text-xs text-mute">{p.paid_on}</td><td className="py-1.5 text-xs">{p.note}</td><td className="num py-1.5 text-right"><Money cents={p.amount_cents} /></td><td className="py-1.5 text-right"><button className="text-xs text-mute hover:text-ember" onClick={async () => { await api.deletePayment(p.id); load(); }}>✕</button></td></tr>)}
          </tbody>
          <tfoot><tr className="font-bold"><td className="py-1.5 text-xs" colSpan={2}>{t("pay.received.sum")}</td><td className="num py-1.5 text-right"><Money cents={sum} /></td><td /></tr></tfoot>
        </table>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs"><span className="mb-1 block text-mute">{t("pay.date")}</span><input className={inputCls + " !w-auto"} type="date" value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></label>
        <label className="text-xs"><span className="mb-1 block text-mute">{t("pay.amount")}</span><input className={inputCls + " num !w-28"} type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="flex-1 text-xs"><span className="mb-1 block text-mute">{t("pay.note")}</span><input className={inputCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
        <Button size="sm" onClick={async () => { await api.addPayment(tenant.id, { paid_on: f.paid_on, amount_cents: Math.round(Number(f.amount) * 100), note: f.note }); setF({ ...f, note: "" }); load(); }}>{t("pay.received.add")}</Button>
      </div>
    </div>
  );
}
