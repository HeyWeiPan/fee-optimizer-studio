# Fee Optimizer Studio

A creator-side dashboard for tuning Bags token fee splits with data instead of guesswork.

When you launch a token on Bags, you pick a fee split — who claims, what BPS share. That decision usually gets made once, in a hurry, and never revisited even as the token's claimer set evolves. This tool gives you the numbers to revisit it: per-claimer accruals, a 30-day what-if simulator, and an empirical baseline drawn from comparable launches.

## Surfaces

**F1 — Wallet token list (`/`)**
Paste an admin wallet, get every Bags token where that wallet is fee-share admin, ranked by lifetime fees in SOL. Click through to the inspector.

**F2 — Token inspector (`/token/:mint`)**
The full picture for one mint: current fee split (donut + table), per-claimer cumulative claimed, recent claim events, pool keys, and a data-integrity check that surfaces if the active BPS doesn't sum to 10000.

**F3 — Split simulator (`/token/:mint/simulate`)**
Drag the BPS sliders, see what the last 30 days *would have* paid each claimer under the new split. Closed-form pool redistribution; nothing on-chain. The "Apply split" CTA wires up to the admin update-config tx flow once wallet signing lands.

**F4 — Comparable launches (embedded in F2)**
For tokens with similar profile (claimer count + 30d accrual bucket), shows how peers have actually settled their per-rank BPS — median + IQR — so you can read your own split against the empirical baseline. Falls loud when the cluster has too few peers; never synthesises.

**F5 — Update-config tx flow (in flight)**
End-to-end signed-tx round-trip against `/fee-share/admin/update-config` and `/solana/send-transaction`. Currently a CLI spike under `scripts/spike-tx-roundtrip.ts`; UI integration lands once wallet signing is wired up.

## Stack

React Router v7 (SSR), TypeScript, Tailwind v4, Recharts, zod for runtime API validation. Bags Public API v2 for everything except the on-chain submit.

## Local dev

```bash
pnpm install
cp .env.example .env       # then paste your BAGS_API_KEY
pnpm dev                   # http://localhost:5173
```

To bootstrap a Bags API key from a local Solana keypair (Ed25519 challenge against `/api-keys/auth`):

```bash
pnpm tsx scripts/bags-auth.ts
```

Smoke-test the API budget before any heavy run:

```bash
pnpm tsx scripts/smoke-feed.ts                      # launch feed + rate headers
pnpm tsx scripts/smoke-admin-list.ts -- <wallet>
```

## Rate budget

The Bags Public API budget is 1000 calls/h sliding window. The client (`app/lib/bags-client.server.ts`) parks at a 500 floor to leave headroom for interactive use. The F4 scout pre-flight aborts if remaining < 600 — never drain into the floor by accident.

## Status

In active build for the DoraHacks Bags hackathon (deadline 2026-06-02). F1–F4 shipped, F5 round-trip spike landed; the next pull is wiring the update-config tx flow into the simulator's "Apply" CTA. Closed-form pool-redistribution model is mass-conserving; the simulator surfaces a data nuance that bites users in practice — actual_30d reflects what was *claimed*, not *accrued*, and the tooltip says so explicitly.
