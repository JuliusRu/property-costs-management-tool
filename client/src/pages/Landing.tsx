import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Button, Card, inputCls, Wordmark } from "../ui";

export default function Landing() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Wordmark />
        <nav className="flex items-center gap-6 text-sm font-semibold">
          <a href="#how" className="hidden text-ink-soft hover:text-ink sm:inline">How it works</a>
          <a href="#pricing" className="hidden text-ink-soft hover:text-ink sm:inline">Pricing</a>
          <Link to="/login" className="text-ink-soft hover:text-ink">Sign in</Link>
          <a href="#waitlist"><Button size="sm">Join the waitlist</Button></a>
        </nav>
      </header>

      {/* Hero: the claim on the left, the thing tenants actually receive on the right */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <h1 className="display text-5xl sm:text-6xl lg:text-7xl">Every invoice in.<br />Every tenant's statement out.<br /><span className="text-cobalt">Every number traceable.</span></h1>
          <p className="mt-6 max-w-xl text-lg text-ink-soft">Billnest pulls your utility and service invoices, reads them with AI, splits them per tenant with deterministic rules, and sends statements your tenants can check line by line. For landlords with 1–20 units in Germany.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#waitlist"><Button size="lg">Join the waitlist</Button></a>
            <Link to="/login"><Button size="lg" variant="ghost">See the live demo</Button></Link>
          </div>
          <p className="mt-4 text-sm text-mute">Free for your first two units. No credit card.</p>
        </div>
        <div className="lg:col-span-5">
          <StatementPreview />
        </div>
      </section>

      {/* Problem */}
      <section className="bg-ink text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-2">
          <div>
            <h2 className="display text-4xl">The one evening a year every landlord dreads</h2>
          </div>
          <div className="space-y-4 text-lg text-white/80">
            <p>Twelve invoices from six providers. A spreadsheet from last year that nobody trusts. A tenant who moved out in May. And the law says: get it right, or the tenant owes you nothing.</p>
            <p>Studies put the share of faulty German operating cost statements at roughly one in two. Most errors are not fraud — they are arithmetic, wrong keys, and vacancy quietly spread over the wrong people.</p>
          </div>
        </div>
      </section>

      {/* How it works — a real sequence, so numbers are fair */}
      <section id="how" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="display max-w-2xl text-4xl">From a pile of PDFs to sent statements in one sitting</h2>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {[
            ["Invoices arrive by themselves", "Connect your inbox or upload PDFs and photos. Billnest reads provider, amount, period and cost type — and flags what is not allocable under § 2 BetrKV, like that repair hidden in the caretaker's bill."],
            ["You confirm, code calculates", "AI never books a cent. Deterministic rules split every invoice by area, persons, unit or metered consumption, day-exact for move-ins and move-outs, heating 30/70 per HeizkostenV."],
            ["Tenants get a statement they can check", "One click sends a PDF and a personal portal link. Each line shows the formula with the real numbers and links to the original invoice. Fewer questions, fewer objections."],
          ].map(([t, d], i) => (
            <li key={t} className="rounded-[var(--radius-card)] border border-line p-6">
              <div className="display text-3xl text-cobalt">{i + 1}</div>
              <div className="mt-3 text-lg font-bold">{t}</div>
              <p className="mt-2 text-sm text-ink-soft">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Differentiators */}
      <section className="bg-surface">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="display max-w-2xl text-4xl">Built on three rules other tools skip</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <Rule title="Vacancy is your cost, not theirs">When a flat sits empty for 243 days, that share is booked to you. Billnest never spreads it over the remaining tenants — the most common hidden error in home-made statements.</Rule>
            <Rule title="Every number has a formula">943,51 € × 58 m² / 178 m² = 307,43 €. Then × 122 / 365 days. The tenant sees it, you see it, a court would see it.</Rule>
            <Rule title="AI reads, it does not decide">Extraction confidence is shown per invoice. Anything under 70 % is flagged for you. The final calculation is integer cents in plain code, tested for every edge case we know.</Rule>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="display text-4xl">Priced per unit, per year — like the statement itself</h2>
        <p className="mt-3 max-w-xl text-ink-soft">A statement is a once-a-year job. You should not pay a monthly SaaS fee for it.</p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <Plan name="Starter" price="Free" per="up to 2 units" points={["Invoice reading with AI", "Statements as PDF", "Tenant portal"]} />
          <Plan name="Landlord" price="24 €" per="per unit, per year" highlight points={["Everything in Starter", "Inbox sync with your providers", "Statements sent by e-mail", "Move-in / move-out, vacancy, heating 30/70", "Unlimited buildings"]} />
          <Plan name="Property manager" price="from 149 €" per="per month" points={["Everything in Landlord", "Multiple clients and owners", "Owner reports and exports", "Priority support"]} />
        </div>
        <p className="mt-6 text-xs text-mute">Prices excl. VAT where applicable. Billing via a merchant of record; details on launch.</p>
      </section>

      {/* Waitlist */}
      <section id="waitlist" className="bg-cobalt text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-20 lg:grid-cols-2">
          <div>
            <h2 className="display text-4xl">Get your 2025 statements done with Billnest</h2>
            <p className="mt-4 text-lg text-white/85">We are onboarding landlords in small groups. Tell us how many units you have and we will get you in before the next statement season.</p>
          </div>
          <WaitlistForm />
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10 text-sm text-mute">
        <Wordmark />
        <div className="flex gap-6"><a href="#" className="hover:text-ink">Impressum</a><a href="#" className="hover:text-ink">Datenschutz</a><Link to="/login" className="hover:text-ink">Sign in</Link></div>
        <div>Billnest computes under stated rules and is not legal advice.</div>
      </footer>
    </div>
  );
}

function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><div className="text-lg font-bold">{title}</div><p className="mt-2 text-sm text-ink-soft">{children}</p></div>;
}

function Plan({ name, price, per, points, highlight }: { name: string; price: string; per: string; points: string[]; highlight?: boolean }) {
  return (
    <Card className={`p-6 ${highlight ? "border-cobalt ring-2 ring-cobalt" : ""}`}>
      <div className="font-bold">{name}</div>
      <div className="display mt-3 text-4xl">{price}</div>
      <div className="text-sm text-mute">{per}</div>
      <ul className="mt-6 space-y-2 text-sm">{points.map((p) => <li key={p} className="flex gap-2"><span className="text-cobalt">✓</span>{p}</li>)}</ul>
      <a href="#waitlist" className="mt-6 block"><Button className="w-full" variant={highlight ? "primary" : "ghost"}>Join the waitlist</Button></a>
    </Card>
  );
}

function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [units, setUnits] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [err, setErr] = useState("");
  if (state === "done") return <Card className="p-8 text-ink"><div className="text-xl font-bold">You are on the list.</div><p className="mt-2 text-sm text-ink-soft">We will write to {email} when your group opens.</p></Card>;
  return (
    <form className="rounded-[var(--radius-card)] bg-paper p-6 text-ink" onSubmit={async (e) => {
      e.preventDefault(); setState("busy"); setErr("");
      try { await api.waitlist(email, units ? Number(units) : null); setState("done"); } catch (ex) { setErr((ex as Error).message); setState("error"); }
    }}>
      <label className="block text-sm"><span className="mb-1 block font-medium">Your e-mail</span><input className={inputCls} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
      <label className="mt-3 block text-sm"><span className="mb-1 block font-medium">How many units do you rent out?</span><input className={inputCls} type="number" min="1" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="e.g. 4" /></label>
      {err && <p className="mt-2 text-sm text-ember">{err}</p>}
      <Button className="mt-4 w-full" size="lg" type="submit" disabled={state === "busy"}>Join the waitlist</Button>
      <p className="mt-3 text-xs text-mute">One e-mail when your group opens. No newsletter.</p>
    </form>
  );
}

/** A faithful mock of what a tenant receives — same numbers as the demo building. */
function StatementPreview() {
  const lines = [
    ["Heating", "30 % by area + 70 % by kWh", "643,08 €"],
    ["Caretaker", "1.713,60 € × 58 / 178 m² · repair excluded", "558,36 €"],
    ["Property tax", "984,00 € × 58 m² / 178 m²", "320,63 €"],
    ["Water & sewage", "943,51 € × 38 m³ / 143 m³", "250,72 €"],
  ];
  return (
    <Card className="overflow-hidden shadow-[0_30px_60px_-30px_rgba(16,28,58,0.35)]">
      <div className="flex items-center justify-between border-b border-line px-5 py-3 text-xs text-mute"><span>Statement 2025 · Lindenstraße 12, ground floor</span><span>Lena H.</span></div>
      <div className="px-5 py-5">
        <div className="text-xs font-medium text-mute">You get back</div>
        <div className="display num text-5xl text-mint">126,63 €</div>
        <div className="num mt-1 text-xs text-mute">costs 2.153,37 € − prepaid 2.280,00 €</div>
      </div>
      <table className="w-full border-t border-line text-xs">
        <tbody className="divide-y divide-line">
          {lines.map(([c, f, v]) => <tr key={c}><td className="px-5 py-2 font-medium">{c}</td><td className="num px-2 py-2 text-mute">{f}</td><td className="num px-5 py-2 text-right font-semibold">{v}</td></tr>)}
        </tbody>
      </table>
    </Card>
  );
}
