import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Badge, Button, Card, inputCls, Wordmark } from "../ui";
import { LangSwitch, useT, type Key } from "../i18n";

export default function Landing() {
  const t = useT();
  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Wordmark />
        <nav className="flex items-center gap-5 text-sm font-semibold">
          <a href="#how" className="hidden text-ink-soft hover:text-ink sm:inline">{t("l.how")}</a>
          <a href="#pricing" className="hidden text-ink-soft hover:text-ink sm:inline">{t("l.pricing")}</a>
          <Link to="/login" className="text-ink-soft hover:text-ink">{t("l.signin")}</Link>
          <LangSwitch />
          <a href="#waitlist"><Button size="sm">{t("l.join")}</Button></a>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <h1 className="display text-5xl sm:text-6xl lg:text-7xl">{t("l.h1a")}<br />{t("l.h1b")}<br /><span className="text-cobalt">{t("l.h1c")}</span></h1>
          <p className="mt-6 max-w-xl text-lg text-ink-soft">{t("l.lead")}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#waitlist"><Button size="lg">{t("l.join")}</Button></a>
            <Link to="/login"><Button size="lg" variant="ghost">{t("l.demo")}</Button></Link>
          </div>
          <p className="mt-4 text-sm text-mute">{t("l.free")}</p>
        </div>
        <div className="lg:col-span-5"><StatementPreview /></div>
      </section>

      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-2">
          <h2 className="display text-4xl">{t("l.problem.h")}</h2>
          <div className="space-y-4 text-lg text-white/80"><p>{t("l.problem.1")}</p><p>{t("l.problem.2")}</p></div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="display max-w-2xl text-4xl">{t("l.steps.h")}</h2>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {(["1", "2", "3"] as const).map((n) => (
            <li key={n} className="rounded-[var(--radius-card)] border border-line p-6">
              <div className="display text-3xl text-cobalt">{n}</div>
              <div className="mt-3 text-lg font-bold">{t(`l.step${n}` as Key)}</div>
              <p className="mt-2 text-sm text-ink-soft">{t(`l.step${n}.d` as Key)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Product tour: three real UI fragments, not screenshots — always in sync with the app's design */}
      <section className="bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="display max-w-2xl text-4xl">{t("l.tour.h")}</h2>
          <div className="mt-12 grid gap-8 lg:grid-cols-3">
            <TourCard title={t("l.tour.1")} text={t("l.tour.1.d")}><OccupancyMock /></TourCard>
            <TourCard title={t("l.tour.2")} text={t("l.tour.2.d")}><ChecksMock /></TourCard>
            <TourCard title={t("l.tour.3")} text={t("l.tour.3.d")}><PortalMock /></TourCard>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="display max-w-2xl text-4xl">{t("l.rules.h")}</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {(["1", "2", "3"] as const).map((n) => <div key={n}><div className="text-lg font-bold">{t(`l.rule${n}` as Key)}</div><p className="mt-2 text-sm text-ink-soft">{t(`l.rule${n}.d` as Key)}</p></div>)}
          </div>
        </div>
      </section>

      {/* Rules */}
      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <h2 className="display text-4xl">{t("l.rulesbox.h")}</h2>
            <p className="mt-4 text-white/75">{t("l.rulesbox.sub")}</p>
            <p className="mt-6 text-xs text-white/50">{t("l.rules.note")}</p>
          </div>
          <ul className="space-y-3 text-sm lg:col-span-3">
            {(["1", "2", "3", "4", "5", "6"] as const).map((n) => <li key={n} className="flex gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3"><span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-cobalt" />{t(`l.rules.${n}` as Key)}</li>)}
          </ul>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="display text-4xl">{t("l.pricing.h")}</h2>
        <p className="mt-3 max-w-xl text-ink-soft">{t("l.pricing.sub")}</p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <Plan name={t("l.plan.starter")} price={t("l.plan.free")} per={t("l.plan.starter.per")} points={[t("l.plan.f1"), t("l.plan.f2"), t("l.plan.f3")]} />
          <Plan name={t("l.plan.landlord")} price="24 €" per={t("l.plan.landlord.per")} highlight points={[t("l.plan.f4"), t("l.plan.f5"), t("l.plan.f6"), t("l.plan.f7"), t("l.plan.f8")]} />
          <Plan name={t("l.plan.manager")} price={t("l.plan.manager.price")} per={t("l.plan.manager.per")} points={[t("l.plan.f9"), t("l.plan.f10"), t("l.plan.f11"), t("l.plan.f12")]} />
        </div>
        <p className="mt-6 text-xs text-mute">{t("l.pricing.note")}</p>
      </section>

      {/* FAQ */}
      <section className="bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="display text-4xl">{t("l.faq.h")}</h2>
          <dl className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-2">
            {(["1", "2", "3", "4", "5", "6"] as const).map((n) => <div key={n}><dt className="text-lg font-bold">{t(`l.faq.${n}.q` as Key)}</dt><dd className="mt-2 text-sm text-ink-soft">{t(`l.faq.${n}.a` as Key)}</dd></div>)}
          </dl>
        </div>
      </section>

      <section id="waitlist" className="bg-cobalt text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-20 lg:grid-cols-2">
          <div>
            <h2 className="display text-4xl">{t("l.wait.h")}</h2>
            <p className="mt-4 text-lg text-white/85">{t("l.wait.sub")}</p>
          </div>
          <WaitlistForm />
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-sm text-mute">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Wordmark />
          <div className="flex gap-6"><Link to="/impressum" className="hover:text-ink">{t("l.footer.imprint")}</Link><Link to="/datenschutz" className="hover:text-ink">{t("l.footer.privacy")}</Link><Link to="/login" className="hover:text-ink">{t("l.signin")}</Link></div>
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2 text-xs"><span>{t("l.footer.legal")}</span><span>{t("l.footer.made")}</span></div>
      </footer>
    </div>
  );
}

function Plan({ name, price, per, points, highlight }: { name: string; price: string; per: string; points: string[]; highlight?: boolean }) {
  const t = useT();
  return (
    <Card className={`p-6 ${highlight ? "border-cobalt ring-2 ring-cobalt" : ""}`}>
      <div className="font-bold">{name}</div>
      <div className="display mt-3 text-4xl">{price}</div>
      <div className="text-sm text-mute">{per}</div>
      <ul className="mt-6 space-y-2 text-sm">{points.map((p) => <li key={p} className="flex gap-2"><span className="text-cobalt">✓</span>{p}</li>)}</ul>
      <a href="#waitlist" className="mt-6 block"><Button className="w-full" variant={highlight ? "primary" : "ghost"}>{t("l.join")}</Button></a>
    </Card>
  );
}

function WaitlistForm() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [units, setUnits] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [err, setErr] = useState("");
  if (state === "done") return <Card className="p-8 text-ink"><div className="text-xl font-bold">{t("l.wait.done")}</div><p className="mt-2 text-sm text-ink-soft">{t("l.wait.done.sub", { e: email })}</p></Card>;
  return (
    <form className="rounded-[var(--radius-card)] bg-paper p-6 text-ink" onSubmit={async (e) => {
      e.preventDefault(); setState("busy"); setErr("");
      try { await api.waitlist(email, units ? Number(units) : null); setState("done"); } catch (ex) { setErr((ex as Error).message); setState("error"); }
    }}>
      <label className="block text-sm"><span className="mb-1 block font-medium">{t("l.wait.email")}</span><input className={inputCls} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
      <label className="mt-3 block text-sm"><span className="mb-1 block font-medium">{t("l.wait.units")}</span><input className={inputCls} type="number" min="1" value={units} onChange={(e) => setUnits(e.target.value)} placeholder={t("l.wait.units.ph")} /></label>
      {err && <p className="mt-2 text-sm text-ember">{err}</p>}
      <Button className="mt-4 w-full" size="lg" type="submit" disabled={state === "busy"}>{t("l.join")}</Button>
      <p className="mt-3 text-xs text-mute">{t("l.wait.note")}</p>
    </form>
  );
}

/** A faithful mock of what a tenant receives — same numbers as the demo building. */
function StatementPreview() {
  const t = useT();
  const lines: [string, string, string][] = [
    [t("cat.heating"), t("l.preview.heating"), "643,08 €"],
    [t("cat.caretaker"), t("l.preview.caretaker"), "558,36 €"],
    [t("cat.property_tax"), "984,00 € × 58 m² / 178 m²", "320,63 €"],
    [t("cat.water_sewage"), "943,51 € × 38 m³ / 143 m³", "250,72 €"],
  ];
  return (
    <Card className="overflow-hidden shadow-[0_30px_60px_-30px_rgba(16,28,58,0.35)]">
      <div className="flex items-center justify-between border-b border-line px-5 py-3 text-xs text-mute"><span>{t("l.preview.head")}</span><span>Lena H.</span></div>
      <div className="px-5 py-5">
        <div className="text-xs font-medium text-mute">{t("l.preview.get")}</div>
        <div className="display num text-5xl text-mint">126,63 €</div>
        <div className="num mt-1 text-xs text-mute">{t("l.preview.sub")}</div>
      </div>
      <table className="w-full border-t border-line text-xs">
        <tbody className="divide-y divide-line">
          {lines.map(([c, f, v]) => <tr key={c}><td className="px-5 py-2 font-medium">{c}</td><td className="num px-2 py-2 text-mute">{f}</td><td className="num px-5 py-2 text-right font-semibold">{v}</td></tr>)}
        </tbody>
      </table>
    </Card>
  );
}

function TourCard({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div>
      <Card className="overflow-hidden p-4">{children}</Card>
      <div className="mt-4 text-lg font-bold">{title}</div>
      <p className="mt-1 text-sm text-ink-soft">{text}</p>
    </div>
  );
}

function OccupancyMock() {
  const t = useT();
  const rows: [string, string, number][] = [["EG links", "Lena Hoffmann", 0], ["1. OG", "Familie Öztürk", 0], ["DG", "Tom Becker", 8]];
  return (
    <div className="space-y-3 text-xs">
      <div className="flex justify-between text-mute"><span>Lindenstraße 12 · 2025</span><span className="inline-flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-sm bg-sun" />{t("l.tour.vacant")}</span></div>
      {rows.map(([u, n, vac]) => (
        <div key={u}>
          <div className="mb-1 flex justify-between"><span className="font-semibold">{u}</span><span className="text-mute">{n}</span></div>
          <div className="flex gap-0.5">{Array.from({ length: 12 }, (_, i) => <div key={i} className={`h-2.5 flex-1 rounded-sm ${i < vac ? "bg-sun" : "bg-cobalt"}`} />)}</div>
        </div>
      ))}
    </div>
  );
}

function ChecksMock() {
  const t = useT();
  const items: [("slate" | "amber" | "green"), Key, Key][] = [["slate", "s.lvl.INFO", "l.tour.check1"], ["amber", "s.lvl.WARNING", "l.tour.check2"], ["slate", "s.lvl.INFO", "l.tour.check3"], ["slate", "s.lvl.INFO", "l.tour.check4"]];
  return (
    <div className="text-xs">
      <div className="mb-2 flex items-center gap-2 font-semibold">Checks <Badge tone="green">{t("l.tour.ready")}</Badge></div>
      <ul className="space-y-2">{items.map(([tone, lbl, k], i) => <li key={i} className="flex gap-2"><span className="shrink-0"><Badge tone={tone}>{t(lbl)}</Badge></span><span className="text-ink-soft">{t(k as Key)}</span></li>)}</ul>
    </div>
  );
}

function PortalMock() {
  const t = useT();
  return (
    <div className="text-xs">
      <div className="flex items-center justify-between"><span className="font-semibold">{t("p.statement", { y: 2025 })}</span><Badge tone="green">{t("p.issued", { d: "2026-03-02" })}</Badge></div>
      <div className="mt-2 text-[10px] text-mute">{t("p.youGet")}</div>
      <div className="display num text-3xl text-mint">126,63 €</div>
      <div className="mt-3 divide-y divide-line border-t border-line">
        {[[t("cat.heating"), "643,08 €"], [t("cat.water_sewage"), "250,72 €"], [t("cat.waste"), "138,80 €"]].map(([c, v]) => (
          <div key={c} className="flex items-center justify-between py-1.5"><div>{c}<div className="text-[10px] text-cobalt">{t("p.seeInvoice")}</div></div><span className="num font-semibold">{v}</span></div>
        ))}
      </div>
    </div>
  );
}
