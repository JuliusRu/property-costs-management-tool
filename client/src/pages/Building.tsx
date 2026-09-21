import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Invoice, type Property, type Tenant, type Unit } from "../api";
import { Badge, Button, Card, Field, inputCls, Modal, Money, PageTitle, Spinner } from "../ui";

const YEAR = new Date().getFullYear() - 1;

export default function Building({ property, onChange }: { property: Property; onChange: () => void }) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [editUnit, setEditUnit] = useState<Partial<Unit> | null>(null);
  const [editTenant, setEditTenant] = useState<(Partial<Tenant> & { unit_id: number }) | null>(null);
  const [editProp, setEditProp] = useState(false);
  useEffect(() => { api.invoices(property.id).then(setInvoices); }, [property.id]);

  const thisYear = invoices.filter((i) => i.period_start.startsWith(String(YEAR)));
  const total = thisYear.filter((i) => i.allocable).reduce((s, i) => s + i.amount_cents, 0);
  const totalArea = property.units.reduce((s, u) => s + u.area_sqm, 0);

  return (
    <>
      <PageTitle title={property.name} sub={property.address}
        right={<div className="flex gap-2"><Button variant="ghost" onClick={() => setEditProp(true)}>Edit building</Button><Button onClick={() => setEditUnit({})}>Add unit</Button></div>} />

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Units" value={String(property.units.length)} sub={`${totalArea} m² in total`} />
        <Stat label={`Invoices ${YEAR}`} value={String(thisYear.length)} sub={`${thisYear.filter((i) => i.source !== "manual").length} read by AI`} />
        <Stat label={`Allocable costs ${YEAR}`} value={<Money cents={total} />} sub="whole building" />
        <Stat label="Tenants" value={String(property.tenants.length)} sub={`${property.units.filter((u) => !property.tenants.some((t) => t.unit_id === u.id)).length} units vacant`} />
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="font-semibold">Units, tenants and occupancy {YEAR}</div>
          <div className="flex items-center gap-4 text-xs text-mute"><span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm bg-cobalt" />tenant</span><span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-4 rounded-sm bg-sun" />vacant → owner pays</span></div>
        </div>
        {property.units.length === 0 && <div className="px-5 py-12 text-center text-sm text-mute">No units yet. Add the first apartment, garage or shop.</div>}
        <div className="divide-y divide-line">
          {property.units.map((u) => {
            const tenants = property.tenants.filter((t) => t.unit_id === u.id);
            return (
              <div key={u.id} className="grid grid-cols-12 items-center gap-4 px-5 py-4">
                <div className="col-span-3">
                  <button className="text-left font-semibold hover:text-cobalt" onClick={() => setEditUnit(u)}>{u.label}</button>
                  <div className="text-xs text-mute">{u.area_sqm} m² · {u.persons} {u.persons === 1 ? "person" : "persons"} · {u.heating_kwh.toLocaleString("de-DE")} kWh · {u.water_m3} m³</div>
                </div>
                <div className="col-span-4">
                  {tenants.length === 0 && <span className="text-sm text-mute">Vacant all year</span>}
                  {tenants.map((t) => (
                    <div key={t.id} className="text-sm">
                      <button className="font-medium hover:text-cobalt" onClick={() => setEditTenant(t)}>{t.name}</button>
                      <span className="text-mute"> · <Money cents={t.monthly_prepayment_cents} />/month</span>
                      {(t.move_in && t.move_in > `${YEAR}-01-01`) && <> <Badge tone="blue">in {t.move_in}</Badge></>}
                      {(t.move_out && t.move_out < `${YEAR}-12-31`) && <> <Badge tone="amber">out {t.move_out}</Badge></>}
                    </div>
                  ))}
                  <button className="mt-1 text-xs font-semibold text-cobalt hover:underline" onClick={() => setEditTenant({ unit_id: u.id })}>+ tenant</button>
                </div>
                <div className="col-span-5"><OccupancyBar tenants={tenants} year={YEAR} /></div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Link to="/app/invoices" className="rounded-[var(--radius-card)] border border-line bg-paper p-5 transition-colors hover:border-cobalt">
          <div className="font-semibold">Next: collect the year's invoices</div>
          <div className="mt-1 text-sm text-mute">Sync your inbox or upload PDFs. AI reads provider, amount, period and allocation key — you confirm.</div>
        </Link>
        <Link to="/app/statements" className="rounded-[var(--radius-card)] border border-line bg-paper p-5 transition-colors hover:border-cobalt">
          <div className="font-semibold">Then: generate and send statements</div>
          <div className="mt-1 text-sm text-mute">One click per year. Every tenant gets a PDF and a portal link to check each line.</div>
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
    const t = tenants.find((t) => (!t.move_in || t.move_in <= end) && (!t.move_out || t.move_out >= start));
    return t;
  });
  return (
    <div>
      <div className="flex gap-0.5">
        {months.map((t, i) => <div key={i} title={t ? t.name : "vacant"} className={`h-3 flex-1 rounded-sm ${t ? "bg-cobalt" : "bg-sun"}`} />)}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-mute"><span>Jan</span><span>Dec {year}</span></div>
    </div>
  );
}

function PropertyModal({ property, onClose, onSaved }: { property: Property; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: property.name, address: property.address });
  return (
    <Modal title="Building" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Address"><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      </div>
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={async () => { await api.updateProperty(property.id, f); onSaved(); }}>Save</Button></div>
    </Modal>
  );
}

function UnitModal({ unit, propertyId, onClose, onSaved }: { unit: Partial<Unit>; propertyId: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ label: unit.label ?? "", area_sqm: unit.area_sqm ?? 0, persons: unit.persons ?? 1, heating_kwh: unit.heating_kwh ?? 0, water_m3: unit.water_m3 ?? 0 });
  const [busy, setBusy] = useState(false);
  const n = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === "label" ? e.target.value : Number(e.target.value) });
  return (
    <Modal title={unit.id ? `Unit ${unit.label}` : "New unit"} sub="Area and persons drive most keys; heating and water readings drive consumption keys." onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Label"><input className={inputCls} value={f.label} onChange={n("label")} placeholder="e.g. 2nd floor left" autoFocus /></Field></div>
        <Field label="Living area (m²)"><input className={inputCls} type="number" step="0.1" value={f.area_sqm} onChange={n("area_sqm")} /></Field>
        <Field label="Persons"><input className={inputCls} type="number" value={f.persons} onChange={n("persons")} /></Field>
        <Field label="Heating consumption (kWh/year)"><input className={inputCls} type="number" value={f.heating_kwh} onChange={n("heating_kwh")} /></Field>
        <Field label="Water consumption (m³/year)"><input className={inputCls} type="number" step="0.1" value={f.water_m3} onChange={n("water_m3")} /></Field>
      </div>
      <div className="mt-5 flex items-center justify-between">
        {unit.id ? <Button variant="danger" size="sm" onClick={async () => { if (confirm("Delete this unit and its tenants?")) { await api.deleteUnit(unit.id!); onSaved(); } }}>Delete unit</Button> : <span />}
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !f.label} onClick={async () => { setBusy(true); if (unit.id) await api.updateUnit(unit.id, f); else await api.createUnit(propertyId, f); onSaved(); }}>{busy ? <Spinner /> : null} Save</Button></div>
      </div>
    </Modal>
  );
}

function TenantModal({ tenant, onClose, onSaved }: { tenant: Partial<Tenant> & { unit_id: number }; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: tenant.name ?? "", email: tenant.email ?? "", prepay: (tenant.monthly_prepayment_cents ?? 0) / 100, move_in: tenant.move_in ?? "", move_out: tenant.move_out ?? "" });
  const [busy, setBusy] = useState(false);
  const body = () => ({ name: f.name, email: f.email, monthly_prepayment_cents: Math.round(f.prepay * 100), move_in: f.move_in || null, move_out: f.move_out || null });
  return (
    <Modal title={tenant.id ? tenant.name! : "New tenant"} sub="Move-in and move-out dates split the year day-exactly. Days without a tenant are charged to you, not to the others." onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="E-mail"><input className={inputCls} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Monthly prepayment (€)"><input className={inputCls} type="number" step="1" value={f.prepay} onChange={(e) => setF({ ...f, prepay: Number(e.target.value) })} /></Field>
        <div />
        <Field label="Move-in" hint="empty = before this year"><input className={inputCls} type="date" value={f.move_in} onChange={(e) => setF({ ...f, move_in: e.target.value })} /></Field>
        <Field label="Move-out" hint="empty = still living there"><input className={inputCls} type="date" value={f.move_out} onChange={(e) => setF({ ...f, move_out: e.target.value })} /></Field>
      </div>
      <div className="mt-5 flex items-center justify-between">
        {tenant.id ? <Button variant="danger" size="sm" onClick={async () => { if (confirm("Remove this tenant?")) { await api.deleteTenant(tenant.id!); onSaved(); } }}>Remove tenant</Button> : <span />}
        <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !f.name || !f.email} onClick={async () => { setBusy(true); if (tenant.id) await api.updateTenant(tenant.id, body()); else await api.createTenant(tenant.unit_id, body()); onSaved(); }}>{busy ? <Spinner /> : null} Save</Button></div>
      </div>
    </Modal>
  );
}
