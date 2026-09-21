import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Invoice, type Property, type Tenant, type Unit } from "../api";
import { Badge, Button, Card, Field, inputCls, Modal, Money, PageTitle, Spinner } from "../ui";
import { useT } from "../i18n";

const YEAR = new Date().getFullYear() - 1;

export default function Building({ property, onChange }: { property: Property; onChange: () => void }) {
  const t = useT();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [editUnit, setEditUnit] = useState<Partial<Unit> | null>(null);
  const [editTenant, setEditTenant] = useState<(Partial<Tenant> & { unit_id: number }) | null>(null);
  const [editProp, setEditProp] = useState(false);
  useEffect(() => { api.invoices(property.id).then(setInvoices); }, [property.id]);

  const thisYear = invoices.filter((i) => i.period_start.startsWith(String(YEAR)));
  const total = thisYear.filter((i) => i.allocable).reduce((s, i) => s + i.amount_cents - i.non_allocable_cents, 0);
  const totalArea = property.units.reduce((s, u) => s + u.area_sqm, 0);

  return (
    <>
      <PageTitle title={property.name} sub={property.address}
        right={<div className="flex gap-2"><Button variant="ghost" onClick={() => setEditProp(true)}>{t("b.edit")}</Button><Button onClick={() => setEditUnit({})}>{t("b.addUnit")}</Button></div>} />

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t("b.units")} value={String(property.units.length)} sub={t("b.total", { n: totalArea })} />
        <Stat label={t("b.invoices", { y: YEAR })} value={String(thisYear.length)} sub={t("b.readByAi", { n: thisYear.filter((i) => i.source !== "manual").length })} />
        <Stat label={t("b.allocable", { y: YEAR })} value={<Money cents={total} />} sub={t("b.whole")} />
        <Stat label={t("b.tenants")} value={String(property.tenants.length)} sub={t("b.vacantUnits", { n: property.units.filter((u) => !property.tenants.some((x) => x.unit_id === u.id)).length })} />
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="font-semibold">{t("b.occupancy", { y: YEAR })}</div>
          <div className="flex items-center gap-4 text-xs text-mute"><span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm bg-cobalt" />{t("b.legend.tenant")}</span><span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm bg-sun" />{t("b.legend.vacant")}</span></div>
        </div>
        {property.units.length === 0 && <div className="px-5 py-12 text-center text-sm text-mute">{t("b.noUnits")}</div>}
        <div className="divide-y divide-line">
          {property.units.map((u) => {
            const tenants = property.tenants.filter((x) => x.unit_id === u.id);
            return (
              <div key={u.id} className="grid grid-cols-12 items-center gap-4 px-5 py-4">
                <div className="col-span-3">
                  <button className="text-left font-semibold hover:text-cobalt" onClick={() => setEditUnit(u)}>{u.label}</button>
                  <div className="text-xs text-mute">{u.area_sqm} m² · {u.persons} {u.persons === 1 ? t("common.person") : t("common.persons")} · {u.heating_kwh.toLocaleString("de-DE")} kWh · {u.water_m3} m³</div>
                </div>
                <div className="col-span-4">
                  {tenants.length === 0 && <span className="text-sm text-mute">{t("b.vacantAll")}</span>}
                  {tenants.map((x) => (
                    <div key={x.id} className="text-sm">
                      <button className="font-medium hover:text-cobalt" onClick={() => setEditTenant(x)}>{x.name}</button>
                      <span className="text-mute"> · <Money cents={x.monthly_prepayment_cents} />/{t("common.month")}</span>
                      {(x.move_in && x.move_in > `${YEAR}-01-01`) && <> <Badge tone="blue">{t("b.in", { d: x.move_in })}</Badge></>}
                      {(x.move_out && x.move_out < `${YEAR}-12-31`) && <> <Badge tone="amber">{t("b.out", { d: x.move_out })}</Badge></>}
                    </div>
                  ))}
                  <button className="mt-1 text-xs font-semibold text-cobalt hover:underline" onClick={() => setEditTenant({ unit_id: u.id })}>{t("b.addTenant")}</button>
                </div>
                <div className="col-span-5"><OccupancyBar tenants={tenants} year={YEAR} /></div>
              </div>
            );
          })}
        </div>
      </Card>

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
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button onClick={async () => { await api.updateProperty(property.id, f); onSaved(); }}>{t("common.save")}</Button></div>
    </Modal>
  );
}

function UnitModal({ unit, propertyId, onClose, onSaved }: { unit: Partial<Unit>; propertyId: number; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [f, setF] = useState({ label: unit.label ?? "", area_sqm: unit.area_sqm ?? 0, persons: unit.persons ?? 1, heating_kwh: unit.heating_kwh ?? 0, water_m3: unit.water_m3 ?? 0 });
  const [busy, setBusy] = useState(false);
  const n = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === "label" ? e.target.value : Number(e.target.value) });
  return (
    <Modal title={unit.id ? t("b.unit.title", { l: unit.label ?? "" }) : t("b.unit.new")} sub={t("b.unit.sub")} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label={t("b.unit.label")}><input className={inputCls} value={f.label} onChange={n("label")} placeholder={t("b.unit.label.ph")} autoFocus /></Field></div>
        <Field label={t("b.unit.area")}><input className={inputCls} type="number" step="0.1" value={f.area_sqm} onChange={n("area_sqm")} /></Field>
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
  const body = () => ({ name: f.name, email: f.email, monthly_prepayment_cents: Math.round(f.prepay * 100), move_in: f.move_in || null, move_out: f.move_out || null });
  return (
    <Modal title={tenant.id ? tenant.name! : t("b.tenant.new")} sub={t("b.tenant.sub")} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("b.tenant.name")}><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label={t("b.tenant.email")}><input className={inputCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label={t("b.tenant.prepay")}><input className={inputCls} type="number" step="1" value={f.prepay} onChange={(e) => setF({ ...f, prepay: Number(e.target.value) })} /></Field>
        {tenant.id ? <Field label={t("b.tenant.code")} hint={t("b.tenant.code.hint")}><div className="num rounded-lg bg-surface px-3 py-2 font-mono text-sm font-bold tracking-widest">{tenant.access_code}</div></Field> : <div />}
        <Field label={t("b.tenant.moveIn")} hint={t("b.tenant.moveIn.hint")}><input className={inputCls} type="date" value={f.move_in} onChange={(e) => setF({ ...f, move_in: e.target.value })} /></Field>
        <Field label={t("b.tenant.moveOut")} hint={t("b.tenant.moveOut.hint")}><input className={inputCls} type="date" value={f.move_out} onChange={(e) => setF({ ...f, move_out: e.target.value })} /></Field>
      </div>
      <div className="mt-5 flex items-center justify-between">
        {tenant.id ? <Button variant="danger" size="sm" onClick={async () => { if (confirm(t("b.tenant.remove.confirm"))) { await api.deleteTenant(tenant.id!); onSaved(); } }}>{t("b.tenant.remove")}</Button> : <span />}
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={busy || !f.name || !f.email} onClick={async () => { setBusy(true); if (tenant.id) await api.updateTenant(tenant.id, body()); else await api.createTenant(tenant.unit_id, body()); onSaved(); }}>{busy ? <Spinner /> : null} {t("common.save")}</Button></div>
      </div>
    </Modal>
  );
}
