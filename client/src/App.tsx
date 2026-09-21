import { useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { api, ApiError, type Property } from "./api";
import { Button, Wordmark } from "./ui";
import Login from "./pages/Login";
import Building from "./pages/Building";
import Invoices from "./pages/Invoices";
import Statements from "./pages/Statements";
import Portal from "./pages/Portal";
import Landing from "./pages/Landing";

function Shell({ property, reload }: { property: Property; reload: () => void }) {
  const nav = useNavigate();
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${isActive ? "bg-white/12 text-white" : "text-white/70 hover:text-white"}`;
  return (
    <div className="min-h-screen bg-surface">
      <header className="bg-ink text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-3">
          <Wordmark light />
          <nav className="flex items-center gap-1">
            <NavLink to="/app" end className={link}>Building</NavLink>
            <NavLink to="/app/invoices" className={link}>Invoices</NavLink>
            <NavLink to="/app/statements" className={link}>Statements</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-white/60 md:inline">{property.name}</span>
            <Button variant="ghost" size="sm" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={async () => { if (confirm("Reset all demo data? This wipes invoices, statements and tenants.")) { await api.reset(); reload(); nav("/app"); } }}>Reset demo</Button>
            <Button variant="ghost" size="sm" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={async () => { await api.logout(); nav("/login"); }}>Log out</Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Routes>
          <Route path="/" element={<Building property={property} onChange={reload} />} />
          <Route path="/invoices" element={<Invoices property={property} />} />
          <Route path="/statements" element={<Statements property={property} onChange={reload} />} />
          <Route path="*" element={<Navigate to="/app" />} />
        </Routes>
      </main>
    </div>
  );
}

function LandlordArea() {
  const [property, setProperty] = useState<Property | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "unauth">("loading");
  const load = () =>
    api.properties().then((ps) => { setProperty(ps[0]); setState("ok"); })
      .catch((e) => setState(e instanceof ApiError && e.status === 401 ? "unauth" : "loading"));
  useEffect(() => { load(); }, []);
  if (state === "unauth") return <Navigate to="/login" />;
  if (state === "loading" || !property) return <div className="p-10 text-mute">Loading…</div>;
  return <Shell property={property} reload={load} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/portal/:token" element={<Portal />} />
      <Route path="/app/*" element={<LandlordArea />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
