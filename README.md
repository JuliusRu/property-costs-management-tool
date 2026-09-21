# Billnest — operating cost statements on autopilot

Built at the MAIN × SpaceX AI Hackathon, Maastricht, 21 Sept 2026 (Track: Build your own Startup).

**The problem.** Germany has ~3.9 million private landlords with 1–5 units. Every year each of them has to
produce a *Betriebskostenabrechnung* (operating cost statement) per tenant: collect a dozen provider invoices,
decide which costs are allocable (§ 2 BetrKV), distribute them by the right key, net them against prepayments,
and send a document the tenant can verify. Most do it in Excel — and roughly every second statement is wrong.

**What Billnest does.**

1. **Invoices come in automatically.** A sync job pulls provider invoices (demo: simulated inbox), or you upload PDFs/photos.
2. **AI reads them** — provider, amount, period, cost category, allocation key, and whether the cost is allocable at all.
   You review and confirm; the AI never books anything on its own.
3. **Deterministic code calculates.** Integer cents, largest-remainder rounding, per-unit keys (area, persons, per unit,
   heating kWh, water m³), day-exact occupancy. **Vacancy stays with the owner** — it is never silently spread over the other tenants.
4. **Every number is traceable.** Each statement line shows its formula with the real numbers
   (`943,51 € × 58 m² / 178 m² = 307,43 €; × 122 / 365 days occupied = …`), and links to the original invoice.
5. **One click sends everything.** Each tenant receives a German PDF statement by e-mail plus a personal portal link
   where they can check every line against the source document.

## Demo access (MAIN × SpaceX AI Hackathon, 21 Sept 2026)

Live: **https://invoice.properties** — landlord login `jury@main.nl` / `Basics`. Two demo buildings; from any statement, "Portal" opens the tenant's view.
Market research (segments, competitors, willingness to pay): see `Market Research.pdf` in this repository.

## Run it locally

Requires Node ≥ 23.4 (uses the built-in `node:sqlite`).

```bash
cp .env.example .env        # then fill in LANDLORD_PASSWORD, SESSION_SECRET, OPENROUTER_API_KEY, BREVO_API_KEY
npm install && npm --prefix client install
npm run samples             # generates the demo provider invoices into samples/
npm run dev                 # API on :3000, web on :5173 (proxied)
```

Open http://localhost:5173, log in with `LANDLORD_PASSWORD`. Demo flow:
**Invoices → Sync inbox** (AI reads four invoices, one contains a non-allocable repair) → **Statements → Generate**
(see reconciliation, checks, the DG unit's vacancy booked to the owner) → **Lines** (formulas) → **Send** → open the **Portal** link.
**Reset demo data** in the sidebar wipes everything and reseeds.

`npm test` runs the allocation engine tests (rounding invariants, vacancy, tenant change, leap years, duplicates).

## Architecture

```
client/   Vite + React + TypeScript + Tailwind — landlord app and tenant portal
server/   Express 5 on Node, node:sqlite (single file), no ORM
  allocation.ts   pure, deterministic engine — the only place money is calculated
  ai.ts           OpenRouter call for invoice extraction; output is coerced into our enums, never trusted blindly
  pdf.ts          German statement PDF (pdfkit)
  mail.ts         Brevo transactional mail with PDF attachment
  auth.ts         HMAC-signed landlord session cookie; tenants use unguessable portal tokens
samples/  synthetic provider invoices for the simulated inbox sync
```

Deploy: one container (`Dockerfile`), mount `/app/data` and `/app/uploads` as volumes. Runs on Coolify.

### Live (since 2026-09-21)

- **https://invoice.properties** — Coolify app `p8kc0ww4kkk00o4cgcgo4ooc` on the Oracle VPS (92.5.112.7), Let's Encrypt via Traefik.
- **Every push to `main` deploys automatically** (GitHub webhook → Coolify → Docker build, ~2–3 min). No manual step.
- DNS: Cloudflare zone `invoice.properties`, A record DNS-only (grey cloud — Traefik does the ACME challenge itself). Registrar: Spaceship.
- Env vars live only in Coolify (`LANDLORD_PASSWORD`, `SESSION_SECRET`, `APP_URL`, …). `OPENROUTER_API_KEY` and `BREVO_API_KEY` are still empty there — AI extraction and mail do not work live until they are set.
- Data (`/app/data/app.db`, `/app/uploads`) sits in Docker volumes and survives redeploys; the demo seed ran once on first start.
- Logins for the hackathon demo are in `~/.secrets/invoice-properties.txt` (not in the repo).

## German rules covered (rules version: DE 2025-01)

| Rule | Where |
|---|---|
| § 2 BetrKV catalogue (17 cost types) incl. partial exclusion of non-allocable items | invoice categories, split field |
| § 556a BGB allocation keys: area, persons, per unit, metered consumption | allocation engine |
| Day-exact occupancy; vacancy is the owner's share, never spread over tenants | engine, building reconciliation |
| HeizkostenV § 7: 50–70 % by consumption (configurable), rest by area; § 11 exemption for owner-occupied two-unit buildings | building settings |
| Decentral heating (per-flat gas/electric): no heating allocation at all | building settings → check |
| CO2KostAufG § 7: landlord's CO₂ share from emissions per m² (10 stages), fuel factor by heating type | invoice fields co2/kWh, engine |
| TKG § 72: cable/TV not allocable for periods from 1 July 2024 | check + exclusion |
| § 556 (3) BGB: 12-month deadline; § 556 (2) flat rate (Pauschale) → no statement | checks, lease rules |
| § 560 (4) BGB: suggested new prepayment after the statement | statement + PDF |
| Lease rules rank above the building default; deviations are booked to the landlord and shown | lease scan → confirm → engine |
| Unit types: garages excluded from persons/consumption pools | unit settings |

Not yet: interim meter readings on tenant change (§ 9b HeizkostenV), hot-water share of a combined system (§ 9), commercial Vorwegabzug, non-calendar billing periods, actual (instead of contractual) prepayments. NL/EU: same UI, different rule set behind it — planned.

## Security notes

- The OpenRouter and Brevo keys live only in the server environment; nothing is called from the browser.
- Landlord auth is a single password (demo scope). Tenant portal links are 128-bit random tokens; the portal only exposes
  invoices of the tenant's own building.
- Uploads are size-limited (10 MB), restricted to PDF/images, and stored under sanitised names outside the web root.
- All amounts are integer cents; no floating point money anywhere.

## What this is not (yet)

Roadmap, in priority order: multi-tenant accounts (Supabase/RLS), real provider connectors (e-mail inbox parsing, portal
scraping), heating cost split 30/70 per HeizkostenV incl. CO₂ cost split (CO2KostAufG), interim meter readings on tenant
change, contract-specific rules with priority over building defaults, versioned legal rule registry, audit trail, NL/EU
cost catalogues behind the same UI. **This tool does not give legal advice** — it computes under stated rules and flags
what a professional should review.
