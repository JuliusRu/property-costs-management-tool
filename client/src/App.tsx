import { useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { api, ApiError, type Organization, type Property } from "./api";
import { Button, Card, Field, inputCls, Modal, Spinner, Wordmark } from "./ui";
import { LangSwitch, useT } from "./i18n";
import Login, { ResetPassword } from "./pages/Login";
import { supabase } from "./supabase";
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
  const [account, setAccount] = useState(false);
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
            <Button variant="ghost" size="sm" className={ghost} onClick={() => setAccount(true)}>{t("nav.account")}</Button>
            <Button variant="ghost" size="sm" className={ghost} onClick={async () => { await (await supabase()).auth.signOut(); nav("/login"); }}>{t("nav.logout")}</Button>
          </div>
        </div>
      </header>
      {account && <AccountModal onClose={() => setAccount(false)} />}
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

/** Landlord details printed on statements (sender, bank account for additional payments). */
function AccountModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [me, setMe] = useState<{ email: string; org: Organization | null } | null>(null);
  const [f, setF] = useState({ name: "", landlord_name: "", landlord_address: "", iban: "", contact_email: "" });
  const [saved, setSaved] = useState(false);
  useEffect(() => { api.me().then((m) => { setMe(m); const o = m.org; if (o) setF({ name: o.name ?? "", landlord_name: o.landlord_name ?? "", landlord_address: o.landlord_address ?? "", iban: o.iban ?? "", contact_email: o.contact_email ?? "" }); }); }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setF({ ...f, [k]: e.target.value }); setSaved(false); };
  return (
    <Modal title={t("acc.title")} sub={me ? t("acc.sub", { e: me.email }) : undefined} onClose={onClose}>
      <div className="space-y-3">
        <Field label={t("acc.org")}><input className={inputCls} value={f.name} onChange={set("name")} /></Field>
        <Field label={t("acc.landlordName")} hint={t("acc.landlordName.hint")}><input className={inputCls} value={f.landlord_name} onChange={set("landlord_name")} /></Field>
        <Field label={t("acc.address")}><textarea className={inputCls} rows={2} value={f.landlord_address} onChange={set("landlord_address")} /></Field>
        <Field label={t("acc.iban")} hint={t("acc.iban.hint")}><input className={inputCls} value={f.iban} onChange={set("iban")} placeholder="DE00 0000 0000 0000 0000 00" /></Field>
        <Field label={t("acc.email")}><input className={inputCls} type="email" value={f.contact_email} onChange={set("contact_email")} /></Field>
      </div>
      <div className="mt-5 flex items-center justify-end gap-2">
        {saved && <span className="text-sm text-mint">{t("acc.saved")}</span>}
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button onClick={async () => { await api.updateOrganization(f); setSaved(true); }}>{t("common.save")}</Button>
      </div>
    </Modal>
  );
}

/** First visit of a fresh account: create the first building, or load the two sample buildings. */
function Onboarding({ onDone }: { onDone: (id?: number) => void }) {
  const t = useT();
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", address: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="min-h-screen bg-surface">
      <header className="bg-ink text-white"><div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3"><Wordmark light /><div className="flex items-center gap-3"><LangSwitch light /><Button variant="ghost" size="sm" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={async () => { await (await supabase()).auth.signOut(); nav("/login"); }}>{t("nav.logout")}</Button></div></div></header>
      <main className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="display text-4xl">{t("onb.title")}</h1>
        <p className="mt-2 max-w-xl text-mute">{t("onb.sub")}</p>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Card className="p-6">
            <div className="text-lg font-bold">{t("onb.own")}</div>
            <p className="mt-1 text-sm text-mute">{t("onb.own.sub")}</p>
            <div className="mt-4 space-y-3">
              <Field label={t("b.prop.name")}><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Musterstraße 5" autoFocus /></Field>
              <Field label={t("b.prop.address")}><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Musterstraße 5, 12345 Stadt" /></Field>
              <Button className="w-full" disabled={!f.name || busy} onClick={async () => { setBusy(true); const p = await api.createProperty(f); onDone(p.id); }}>{t("onb.create")}</Button>
            </div>
          </Card>
          <Card className="p-6">
            <div className="text-lg font-bold">{t("onb.demo")}</div>
            <p className="mt-1 text-sm text-mute">{t("onb.demo.sub")}</p>
            <Button className="mt-4 w-full" variant="ghost" disabled={busy} onClick={async () => { setBusy(true); setErr(""); try { await api.loadDemo(); onDone(); } catch (e) { setErr((e as Error).message); setBusy(false); } }}>{busy ? <Spinner /> : null} {t("onb.demo.btn")}</Button>
            {err && <p className="mt-2 text-sm text-ember">{err}</p>}
          </Card>
        </div>
      </main>
    </div>
  );
}

function LandlordArea() {
  const t = useT();
  const [properties, setProperties] = useState<Property[]>([]);
  const [selected, setSelected] = useState<number | null>(() => { try { return Number(localStorage.getItem("property")) || null; } catch { return null; } });
  const [state, setState] = useState<"loading" | "ok" | "unauth" | "error">("loading");
  const select = (id: number) => { setSelected(id); try { localStorage.setItem("property", String(id)); } catch { /* ignore */ } };
  const load = async () => {
    // Sign-in state lives in Supabase; no session → login page (also handles the e-mail confirmation link).
    const sb = await supabase();
    const { data } = await sb.auth.getSession();
    if (!data.session) return setState("unauth");
    try { setProperties(await api.properties()); setState("ok"); }
    catch (e) { setState(e instanceof ApiError && e.status === 401 ? "unauth" : "error"); }
  };
  useEffect(() => { load(); }, []);
  if (state === "unauth") return <Navigate to="/login" />;
  if (state === "error") return <div className="p-10 text-ember">{t("onb.error")}</div>;
  if (state === "loading") return <div className="p-10 text-mute">{t("common.loading")}</div>;
  if (properties.length === 0) return <Onboarding onDone={async (id) => { if (id) select(id); await load(); }} />;
  const property = properties.find((p) => p.id === selected) ?? properties[0];
  return <Shell key={property.id} property={property} properties={properties} select={select} reload={load} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/impressum" element={<Impressum />} />
      <Route path="/datenschutz" element={<Datenschutz />} />
      <Route path="/portal" element={<Portal />} />
      <Route path="/portal/:token" element={<Portal />} />
      <Route path="/app/*" element={<LandlordArea />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
