import { useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { api, ApiError, type Property } from "./api";
import { Button, Field, inputCls, Modal, Wordmark } from "./ui";
import { LangSwitch, useT } from "./i18n";
import Login from "./pages/Login";
import Building from "./pages/Building";
import Invoices from "./pages/Invoices";
import Statements from "./pages/Statements";
import Documents from "./pages/Documents";
import Tenants from "./pages/Tenants";
import Portal from "./pages/Portal";
import Landing from "./pages/Landing";
import { Impressum, Datenschutz } from "./pages/Legal";

function Shell({ property, properties, select, reload }: { property: Property; properties: Property[]; select: (id: number) => void; reload: () => void }) {
  const nav = useNavigate();
  const t = useT();
  const [adding, setAdding] = useState(false);
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-white/12 text-white" : "text-white/70 hover:text-white"}`;
  const ghost = "border-white/20 bg-transparent text-white hover:bg-white/10";
  return (
    <div className="min-h-screen bg-surface">
      <header className="bg-ink text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-6 py-3">
          <Wordmark light />
          <nav className="flex items-center gap-1">
            <NavLink to="/app" end className={link}>{t("nav.building")}</NavLink>
            <NavLink to="/app/tenants" className={link}>{t("nav.tenants")}</NavLink>
            <NavLink to="/app/invoices" className={link}>{t("nav.invoices")}</NavLink>
            <NavLink to="/app/statements" className={link}>{t("nav.statements")}</NavLink>
            <NavLink to="/app/documents" className={link}>{t("nav.documents")}</NavLink>
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            <select className="rounded-md border border-white/20 bg-transparent px-2 py-1 text-sm text-white" value={property.id} onChange={(e) => { if (e.target.value === "new") setAdding(true); else select(Number(e.target.value)); }}>
              {properties.map((p) => <option key={p.id} value={p.id} className="text-ink">{p.name}</option>)}
              <option value="new" className="text-ink">+ {t("b.newBuilding")}</option>
            </select>
            <LangSwitch light />
            <Button variant="ghost" size="sm" className={ghost} onClick={async () => { if (confirm(t("nav.reset.confirm"))) { await api.reset(); reload(); nav("/app"); } }}>{t("nav.reset")}</Button>
            <Button variant="ghost" size="sm" className={ghost} onClick={async () => { await api.logout(); nav("/login"); }}>{t("nav.logout")}</Button>
          </div>
        </div>
      </header>
      {adding && <NewBuilding onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); select(id); reload(); nav("/app"); }} />}
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Routes>
          <Route path="/" element={<Building property={property} onChange={reload} />} />
          <Route path="/invoices" element={<Invoices property={property} />} />
          <Route path="/statements" element={<Statements property={property} onChange={reload} />} />
          <Route path="/documents" element={<Documents property={property} />} />
          <Route path="/tenants" element={<Tenants properties={properties} select={(id) => { select(id); nav("/app"); }} />} />
          <Route path="*" element={<Navigate to="/app" />} />
        </Routes>
      </main>
    </div>
  );
}

function NewBuilding({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const t = useT();
  const [f, setF] = useState({ name: "", address: "" });
  return (
    <Modal title={t("b.newBuilding")} sub={t("b.newBuilding.sub")} onClose={onClose}>
      <div className="space-y-3">
        <Field label={t("b.prop.name")}><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus placeholder="Musterstraße 5" /></Field>
        <Field label={t("b.prop.address")}><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      </div>
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button disabled={!f.name} onClick={async () => { const p = await api.createProperty(f); onCreated(p.id); }}>{t("common.save")}</Button></div>
    </Modal>
  );
}

function LandlordArea() {
  const t = useT();
  const [properties, setProperties] = useState<Property[]>([]);
  const [selected, setSelected] = useState<number | null>(() => { try { return Number(localStorage.getItem("property")) || null; } catch { return null; } });
  const [state, setState] = useState<"loading" | "ok" | "unauth">("loading");
  const load = () =>
    api.properties().then((ps) => { setProperties(ps); setState("ok"); })
      .catch((e) => setState(e instanceof ApiError && e.status === 401 ? "unauth" : "loading"));
  useEffect(() => { load(); }, []);
  const select = (id: number) => { setSelected(id); try { localStorage.setItem("property", String(id)); } catch { /* ignore */ } };
  if (state === "unauth") return <Navigate to="/login" />;
  // Default view: the Munich demo building (the richer example), unless the user picked another one.
  const property = properties.find((p) => p.id === selected) ?? properties.find((p) => p.name === "Musterweg 7") ?? properties[0];
  if (state === "loading" || !property) return <div className="p-10 text-mute">{t("common.loading")}</div>;
  return <Shell key={property.id} property={property} properties={properties} select={select} reload={load} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/impressum" element={<Impressum />} />
      <Route path="/datenschutz" element={<Datenschutz />} />
      <Route path="/portal" element={<Portal />} />
      <Route path="/portal/:token" element={<Portal />} />
      <Route path="/app/*" element={<LandlordArea />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
