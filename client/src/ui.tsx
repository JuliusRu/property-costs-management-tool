import type { ReactNode, ButtonHTMLAttributes } from "react";

export const APP_NAME = "Billnest";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function Button({ variant = "primary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const base = "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const v = {
    primary: "bg-slate-900 text-white hover:bg-slate-700",
    ghost: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
    danger: "text-red-600 hover:bg-red-50",
  }[variant];
  return <button className={`${base} ${v} ${className}`} {...p} />;
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const t = {
    slate: "bg-slate-100 text-slate-700", green: "bg-emerald-100 text-emerald-800", amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800", blue: "bg-blue-100 text-blue-800",
  }[tone];
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function Money({ cents, signed = false }: { cents: number; signed?: boolean }) {
  const v = (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  if (!signed) return <span className="tabular-nums">{v}</span>;
  return <span className={`tabular-nums font-semibold ${cents > 0 ? "text-red-600" : "text-emerald-600"}`}>{cents > 0 ? "+" : ""}{v}</span>;
}

export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block text-slate-600">{label}</span>{children}</label>;
}
export const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-800" />;
}
