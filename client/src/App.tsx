import { useEffect, useState } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate } from "react-router-dom";
import { api, ApiError, type Property } from "./api";
import { APP_NAME, Button } from "./ui";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Invoices from "./pages/Invoices";
import Statements from "./pages/Statements";
import Portal from "./pages/Portal";

function Shell({ property, reload }: { property: Property; reload: () => void }) {
  const nav = useNavigate();
  const link = ({ isActive }: { isActive: boolean }) =>
    `block rounded-lg px-3 py-2 text-sm ${isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"}`;
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-slate-100 p-4">
        <div className="mb-8 px-2">
          <div className="text-lg font-bold tracking-tight">{APP_NAME}</div>
          <div className="text-xs text-slate-500">Operating costs on autopilot</div>
        </div>
        <nav className="space-y-1">
          <NavLink to="/" end className={link}>Dashboard</NavLink>
          <NavLink to="/invoices" className={link}>Invoices</NavLink>
          <NavLink to="/statements" className={link}>Statements</NavLink>
        </nav>
        <div className="mt-auto space-y-3 px-2 text-xs text-slate-500">
          <div><div className="font-medium text-slate-700">{property.name}</div>{property.address}</div>
          <Button variant="ghost" className="w-full justify-center" onClick={async () => { await api.logout(); nav("/login"); }}>Log out</Button>
        </div>
      </aside>
      <main className="flex-1 p-8">
        <div className="mx-auto max-w-5xl">
          <Routes>
            <Route path="/" element={<Dashboard property={property} />} />
            <Route path="/invoices" element={<Invoices property={property} />} />
            <Route path="/statements" element={<Statements property={property} onChange={reload} />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </div>
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
  if (state === "loading" || !property) return <div className="p-8 text-slate-500">Loading…</div>;
  return <Shell property={property} reload={load} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/portal/:token" element={<Portal />} />
      <Route path="/*" element={<LandlordArea />} />
    </Routes>
  );
}
