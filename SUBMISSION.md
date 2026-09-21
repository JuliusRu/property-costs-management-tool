# Submission — MAIN × SpaceX AI Hackathon, 21 Sept 2026

Portal: https://main-spacex-ai.web.app/ (Google sign-in, one submitter per team). Deadline **18:00**.
Copy the blocks below into the form.

## Team
- **Team name:** Team 33 (Billnest)
- **Members:** Julius Rummel, Sebastian Sporer
- **Track:** Build your own Startup

## Project name
Billnest — operating cost statements on autopilot

## Short description (≈60 words)
Billnest turns a landlord's pile of provider invoices into a correct, traceable operating-cost statement for every tenant. AI reads invoices and leases and proposes values; deterministic code allocates every cent by the right key (area, co-ownership shares, persons, metered consumption, direct), day-exact for move-ins, move-outs and vacancy. Tenants get a PDF and a portal where every line links to its formula and the original invoice.

## What problem you solve
Germany has ~3.9 million private landlords with 1–20 units. Once a year each has to produce a Betriebskostenabrechnung per tenant: collect 10–15 invoices from six providers, decide what is allocable under § 2 BetrKV, split by the correct key, respect HeizkostenV, CO₂ cost sharing and lease clauses, net against prepayments, and send it within 12 months — or lose the right to claim. Most do it in Excel; studies put the share of faulty statements at roughly one in two. Errors are rarely fraud: wrong keys, vacancy spread over the wrong tenants, non-allocable repairs slipped in, sums that don't reconcile. We took a real 2025 statement from Munich as our test case — its cover letter and its detailed breakdown disagree on five positions. Billnest reproduces the correct breakdown to the cent and cannot produce the wrong letter, because both views are computed from the same lines.

## Demo / project link
- Live app: https://invoice.properties
  - Landlord login: **jury@main.nl / Basics** (built into the server; verified live 21.09. 17:50)
  - Tenant view: "Portal" button on any statement (or lena.hoffmann@example.com / demo1234)
  - Two demo buildings: "Lindenstraße 12" (vacancy, lease scan, CO₂) and "Musterweg 7" (5 units incl. restaurant, MEA shares, waste for apartments only, water metered per unit, credit note)
- Code: https://github.com/JuliusRu/property-costs-management-tool  ← set to Public before submitting
- Video: "Streamlining German Nebenkosten Reconciliation for Landlords.mp4" (14.6 MB) — upload in the form, or host on YouTube (unlisted) / Google Drive and paste the link

## Suggested 3-minute demo path (for the pitch)
1. Landing page → "See the live demo" → landlord login.
2. Building "Musterweg 7": units, tenants, occupancy strip, each unit's share of 2025 costs. Costs section: the year's invoices with their keys (MEA, apartments only, direct).
3. Tenant "Familie Öztürk" (Lindenstraße): "Use sample lease" → AI quotes the clauses verbatim → confirm → the statement shows "lease: 684,45 € × 74 m² / 178 m² … building default would be 277,60 €" and books the 46,79 € difference to the landlord.
4. Statements: reconciliation card (invoiced → non-allocable → allocable → tenants + vacancy + lease deviations, rounding 0), checks (deadline, CO₂ split, cable rule), "Create statement (PDF)" → the Einzelabrechnung layout.
5. Tenant portal: same numbers, every line with formula and "see the invoice"; payment status.

## Why this is a startup (judging: founder thinking, market potential, differentiation)
- **Market:** ~3.9 M private landlords in DE, ~15 M rental units; the job is mandatory and annual. Pricing 24 €/unit/year (a statement is a yearly event, not a subscription); free up to 2 units; property managers from 149 €/month.
- **Differentiation:** competitors (Vermietet.de, objego, Haufe) are form-based. Billnest is (1) automated intake — invoices and leases are read, not typed; (2) rules built in and versioned (BetrKV, § 556a, HeizkostenV 50–70 %, CO2KostAufG stages, TKG 2024 cable rule, § 556 (3) deadline, § 560 (4) prepayment); (3) a tenant portal that turns the statement from a dispute into a receipt.
- **EU path:** same UI, a different rule set behind it — the domain is deliberately .properties, not .de.
- **What we shipped today:** 25 engine tests, deterministic integer-cent allocation with largest-remainder rounding, AI extraction with a no-key fallback so the demo never breaks, live on our own server.

## Before you press submit
- [x] Repo is Public (history checked: no secrets, .env never committed, real documents untracked)
- [x] Jury login works live (no Coolify variables needed). Optional: `DEMO_MODE=1` prefills the login form.
- [ ] Add `Market Research.pdf` to the repo root (README links to that name)
- [ ] Upload the video (or paste a YouTube/Drive link)
- [x] Screenshots in `submission/` (01 landing … 12 statement PDF)
