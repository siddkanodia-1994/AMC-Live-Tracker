# AMC Live AUM Tracker

A personal dashboard that recalculates each Indian mutual fund AMC's equity AUM in near-real-time by
repricing their disclosed holdings against live market data (DHAN API), instead of relying solely on
the once-a-month reported figure.

## How it works

1. Once a month you upload an Excel "MF Tracker" file (Overview sheet + one sheet per AMC listing
   equity/G-Sec holdings). The importer parses it, maps each AMC's Overview name to its sheet name,
   and stores holdings in Postgres, tagged with a report period (e.g. `2026-06`).
2. For every equity holding, the app looks up a live price via DHAN's market-quote API (mapped from
   ISIN to DHAN's numeric security ID via their instrument master) and revalues it as
   `price × shares`. G-Secs, foreign holdings, and anything DHAN can't price fall back to their last
   reported value.
3. A small residual ("cash & other") is frozen at import time as
   `Reported AUM − Σ(all disclosed holdings' value)` and carried forward unchanged, since there's no
   live feed for cash/receivables. In practice this dataset already itemizes cash-equivalents (Net
   Current Asset, TREPS) as disclosed holdings, so the residual is usually ~₹0.
4. Live AUM = Σ(live-priced equities) + Σ(reported G-Sec/other values) + residual. The Overview page
   shows this per AMC alongside the last reported figure and the delta; the AMC detail page shows the
   full holdings breakdown.

## Monthly operating cadence

- Upload a new month's file any time in the first week of the following month (e.g. June's file in
  early July). The importer tags it with the period parsed from the workbook itself, not the filename.
- **History is retained.** Each period's holdings/AUM are stored separately — "live AUM" always uses
  the latest period, but older periods stay in the database for future historical views.
- **Re-uploading the same month is a correction.** The later upload overwrites that period's data;
  other periods are untouched.
- **Gaps are seamless.** Between the 1st of a new month and whenever you get around to uploading that
  month's file, the app just keeps using whichever period is currently latest — no special handling.
- A live-AUM snapshot is persisted once a day per AMC (via Vercel Cron), so day-by-day movement within
  a month is captured from day one even before a full trend-chart UI exists.

## Daily operational task: refreshing the DHAN token

**DHAN access tokens expire every ~24 hours.** Unlike most config, this is *not* an environment
variable — it's stored in the database (`app_settings` table) so it can be updated from the `/admin`
page without a redeploy. Each day:

1. Log in to Dhan Web → Profile → DhanHQ Trading APIs → generate a new access token.
2. Go to `/admin` on your deployed app, enter your `ADMIN_SECRET`, and paste the new token into the
   DHAN access token field.

If the token expires and isn't refreshed, the app keeps working — it just falls back to last-reported
values for every holding and shows a banner saying pricing is unavailable.

## Setup

### 1. Database (Neon Postgres)

Create a free Postgres database at [neon.tech](https://neon.tech) (or via Vercel's Storage tab →
Create Database → Neon), and copy its connection string.

```bash
cp .env.example .env.local
# fill in DATABASE_URL, ADMIN_SECRET, DHAN_CLIENT_ID
npm install
npm run db:generate   # generate SQL migration from src/lib/db/schema.ts
npm run db:migrate    # apply it to your database
```

### 2. First import

```bash
npm run import -- "/path/to/your/tracker.xlsx"
```

This parses the workbook and populates `amcs`, `amc_periods`, and `holdings`. Re-run this (or use the
Excel upload button on `/admin`) each month with the new file.

### 3. DHAN API

1. Get API access from your [Dhan](https://dhan.co) account (Profile → DhanHQ Trading APIs).
2. Set `DHAN_CLIENT_ID` in your env — this is static and doesn't rotate.
3. Generate an access token and paste it into `/admin` (see above) — this rotates daily.
4. Run the instrument-master sync once so ISINs can be mapped to DHAN's security IDs:

```bash
npm run sync-instruments
```

Re-run this weekly, or after each monthly import, to pick up newly listed/relisted stocks.

### 4. Run locally

```bash
npm run dev
```

Visit `http://localhost:3000` for the dashboard and `http://localhost:3000/admin` for settings.

## Deploying to Vercel

This repo is connected to Vercel via GitHub — pushes to `main` deploy automatically. To set this up
from scratch on a new project:

1. Push this repo to GitHub and connect it under the Vercel project's Settings → Git.
2. Add the environment variables from `.env.example` (`DATABASE_URL`, `ADMIN_SECRET`,
   `DHAN_CLIENT_ID`, `CRON_SECRET`) in the Vercel project settings. `DATABASE_URL` is set
   automatically if you provision Postgres via Vercel's Neon marketplace integration.
3. Deploy. `vercel.json` configures a daily cron (`/api/cron/daily-snapshot`) — Vercel automatically
   sends `CRON_SECRET` as a bearer token to authenticate it.
4. After the first deploy, run the import script locally against your production `DATABASE_URL` (or
   use the `/admin` upload button once deployed) to seed data, then run the instrument sync.

## Architecture

- **Next.js 16 (App Router, TypeScript)**, Tailwind CSS, shadcn/ui, `next-themes` for dark mode.
- **Drizzle ORM + Neon serverless Postgres** — `neon-http` driver for fast read-heavy routes,
  `neon-serverless` (pooled) driver for the one path that needs real transactions (import).
- **Excel parsing**: `xlsx` (SheetJS), reading fixed row/column offsets verified against the real
  workbook, with a fallback header-row scanner that throws loudly if a future export shifts rows.
- **DHAN integration**: `src/lib/dhan/` — instrument-master sync (ISIN → security ID, refreshed
  manually), and a batched/chunked LTP client that degrades to fallback pricing on any failure rather
  than breaking the whole computation.
- **Live AUM engine**: `src/lib/aum/compute-live-aum.ts` — dedupes ISINs across all AMCs before
  calling DHAN (a stock held by 40 funds is priced once, not 40 times), caches the result in-memory
  for ~45s, and writes an idempotent daily snapshot as a side effect.

## v1 scope boundary

Built: Excel import (CLI + admin upload) with multi-month history, DHAN live pricing, live AUM
calculation with caching, Overview + AMC detail pages with auto-refresh, dark mode, admin settings,
and a daily AUM snapshot.

Deliberately deferred (data is already being collected to support these later):

- A dedicated historical trend-chart UI (the daily snapshots are already stored)
- CSV/Excel export
- "Top movers" (stocks impacting AUM most)
- Cross-AMC sector exposure page

## Known limitations

- The in-memory live-AUM cache is per serverless instance, not shared — acceptable for personal-scale
  traffic (worst case is one extra DHAN call, never incorrect data).
- `data/amc-name-map.json` is a manually curated mapping between Overview names and sheet tab names
  (they don't match 1:1, especially for SIF products). If a future export renames or adds/removes an
  AMC, the importer will fail loudly rather than silently dropping data — update that file to match.
