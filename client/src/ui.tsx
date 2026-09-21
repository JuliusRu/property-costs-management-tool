import type { ReactNode, ButtonHTMLAttributes } from "react";

export const APP_NAME = "Billnest";

export function Wordmark({ light = false, size = "md" }: { light?: boolean; size?: "md" | "lg" }) {
  const s = size === "lg" ? "text-3xl" : "text-xl";
  return (
    <span className={`inline-flex items-center gap-2 font-extrabold tracking-tight ${s} ${light ? "text-white" : "text-ink"}`} style={{ fontVariationSettings: '"opsz" 96, "wght" 800' }}>
      <svg viewBox="0 0 32 32" className={size === "lg" ? "h-8 w-8" : "h-6 w-6"} aria-hidden>
        <rect width="32" height="32" rx="7" fill={light ? "#ffffff" : "#101C3A"} />
        <path d="M7 18 16 9l9 9" fill="none" stroke="#2246F5" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="11" y="18" width="10" height="6" rx="1.5" fill={light ? "#101C3A" : "#ffffff"} />
      </svg>
      {APP_NAME}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[var(--radius-card)] border border-line bg-paper ${className}`}>{children}</div>;
}

export function Button({ variant = "primary", size = "md", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "ink"; size?: "sm" | "md" | "lg" }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap";
  const sz = { sm: "px-2.5 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-5 py-3 text-base" }[size];
  const v = {
    primary: "bg-cobalt text-white hover:bg-cobalt-deep",
    ink: "bg-ink text-white hover:bg-ink-soft",
    ghost: "border border-line bg-paper text-ink hover:bg-surface",
    danger: "text-ember hover:bg-ember-soft",
  }[variant];
  return <button className={`${base} ${sz} ${v} ${className}`} {...p} />;
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const t = {
    slate: "bg-surface text-ink-soft", green: "bg-mint-soft text-mint", amber: "bg-sun-soft text-[#8a5a00]",
    red: "bg-ember-soft text-ember", blue: "bg-cobalt-soft text-cobalt-deep",
  }[tone];
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
}

export function Money({ cents, signed = false, className = "" }: { cents: number; signed?: boolean; className?: string }) {
  const v = (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  if (!signed) return <span className={`num ${className}`}>{v}</span>;
  return <span className={`num font-bold ${cents > 0 ? "text-ember" : "text-mint"} ${className}`}>{cents > 0 ? "+" : ""}{v}</span>;
}

/** The memorable element: a big balance figure that reads as money owed or money back. */
export function BigMoney({ cents, label }: { cents: number; label?: string }) {
  const due = cents > 0;
  return (
    <div className="text-right">
      <div className="text-xs font-medium text-mute">{label ?? (due ? "Tenant pays" : "Refund")}</div>
      <div className={`display num text-3xl ${due ? "text-ember" : "text-mint"}`}>{(Math.abs(cents) / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</div>
    </div>
  );
}

export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="display text-4xl">{title}</h1>
        {sub && <p className="mt-2 text-[15px] text-mute">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium text-ink-soft">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-mute">{hint}</span>}</label>;
}
export const inputCls = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-cobalt focus:outline-none";

export function Spinner() {
  return <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-cobalt" />;
}

export function Notice({ tone = "blue", children }: { tone?: "blue" | "red" | "green"; children: ReactNode }) {
  const t = { blue: "border-cobalt-soft bg-cobalt-soft/50 text-cobalt-deep", red: "border-ember-soft bg-ember-soft/60 text-ember", green: "border-mint-soft bg-mint-soft/60 text-mint" }[tone];
  return <div className={`mb-5 rounded-lg border px-4 py-2.5 text-sm ${t}`}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="px-8 py-14 text-center">
      <div className="text-lg font-semibold">{title}</div>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-mute">{children}</div>}
    </Card>
  );
}

export function Modal({ title, sub, onClose, children, wide }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/50 p-4" onClick={onClose}>
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} max-h-[92vh] overflow-y-auto rounded-[var(--radius-card)] bg-paper p-6 shadow-2xl`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <h2 className="text-xl font-bold">{title}</h2>
        {sub && <p className="mb-4 mt-1 text-sm text-mute">{sub}</p>}
        {children}
      </div>
    </div>
  );
}
