# AMC Live AUM Tracker

A personal dashboard that recalculates each Indian mutual fund AMC's equity AUM in near-real-time by
repricing their disclosed holdings against live market data (DHAN API), instead of relying solely on
the once-a-month reported figure.

## How it works

1. Once a month you upload an Excel "MF Tracker" file (Overview sheet + one sheet per AMC listing
   equity/G-Sec holdings). The importer parses it, maps each AMC's Overview name to its sheet name,
   and stores holdings in Postgres, tagged with a report period (e.g. `2026-06`).
2. For every domestic (NSE/BSE) equity holding, the app looks up a live price via DHAN's market-quote
   API (mapped from ISIN to DHAN's numeric security ID via their instrument master) and revalues it as
   `price × shares`. US-listed holdings (ISIN starting `US`) are priced separately via Finnhub +
   USD/INR conversion (see below). G-Secs, other-country foreign holdings, and anything neither source
   can price fall back to their last reported value.
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

**DHAN access tokens expire every ~24 hours.** Both the access token and the client ID it's paired
with are stored in the database (`app_settings` table), editable together from the `/admin` page
without a redeploy — the `DHAN_CLIENT_ID` env var is now only a fallback default used until something's
been saved there. Each day:

1. Log in to Dhan Web → Profile → DhanHQ Trading APIs → generate a new access token.
2. Go to `/admin` on your deployed app and paste the new token into the DHAN credentials card. If you
   generated it under a *different* DHAN account than the one already configured, update the Client ID
   field too — a token only works with the client ID it was generated under, and saving a pair DHAN
   rejects is blocked by a live test call before anything is persisted.

If the token expires and isn't refreshed, the app keeps working — it just falls back to last-reported
values for every holding and shows a banner saying pricing is unavailable.

**Note on `/admin`**: this page and its API routes (`/api/admin/*`) are gated behind a shared secret
(`ADMIN_SECRET`) — enter it once at `/admin` and it's remembered in this browser (`localStorage`)
across restarts until you explicitly log out or clear site data, so the daily token-refresh workflow
above stays just as quick as visiting the page directly. The Client ID is also encrypted at rest
(`app_settings` table) and only ever shown/returned masked (last 4 characters) — the DHAN access token
itself is never returned by any endpoint at all, only a "configured/updated" status.

## US-listed holdings (Finnhub)

~169 holdings across all AMCs are US-listed equities (Amazon, Microsoft, etc., held in global/feeder
sleeves) — about 0.9% of total industry AUM. These are priced independently of DHAN:

1. **Sync** (rare — run after each monthly import, whenever the holding list changes):
   `npm run sync-foreign-instruments` resolves each US ISIN to a Finnhub ticker symbol via their
   symbol-search endpoint (it accepts ISIN directly, no manual ticker mapping needed) and stores the
   mapping in `foreign_instrument_map`.
2. **Daily refresh**: a GitHub Actions workflow (`.github/workflows/refresh-foreign-prices.yml`) runs
   once a day, ~2h after US markets close, fetching each mapped symbol's latest quote from Finnhub and
   the current USD/INR rate from ExchangeRate-API, caching both in Postgres. This runs in GitHub
   Actions rather than Vercel Cron because refreshing ~169 symbols at Finnhub's free-tier rate limit
   (60/min) takes a few minutes — longer than Vercel's serverless function timeout allows.
3. The live-AUM engine reads these cached values (never calls Finnhub live per-request) — if the cache
   is missing or stale, those holdings simply fall back to their last reported value, same as any other
   pricing gap in the app.

**Setup**: get a free Finnhub API key at [finnhub.io/register](https://finnhub.io/register) (no card
required) and set `FINNHUB_API_KEY`. For the GitHub Actions workflow to run, add `DATABASE_URL` and
`FINNHUB_API_KEY` as repository secrets (Settings → Secrets and variables → Actions).

## Setup

### 1. Database (Neon Postgres)

Create a free Postgres database at [neon.tech](https://neon.tech) (or via Vercel's Storage tab →
Create Database → Neon), and copy its connection string.

```bash
cp .env.example .env.local
# fill in DATABASE_URL, ADMIN_SECRET, SETTINGS_ENCRYPTION_KEY, DHAN_CLIENT_ID
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
2. Set `DHAN_CLIENT_ID` in your env as a fallback default — optional once you've saved a client ID
   from `/admin`, since the database value takes precedence from then on.
3. Generate an access token and paste both it and your client ID into `/admin` (see above) — the token
   rotates daily, the client ID rarely if ever.
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
   `SETTINGS_ENCRYPTION_KEY`, `DHAN_CLIENT_ID`, `CRON_SECRET`) in the Vercel project settings.
   `DATABASE_URL` is set automatically if you provision Postgres via Vercel's Neon marketplace
   integration.
3. Deploy. `vercel.json` configures the daily-snapshot cron (`/api/cron/daily-snapshot`) to run twice
   — 4:00 PM and 6:00 PM IST, both after the 3:30 PM market close — so a DHAN blip on the first run
   (rate limit, transient error) gets corrected by the second instead of freezing that day's chart
   point until the next manual audit. The route's overwrite-on-conflict write means either run can
   safely follow the other. Vercel automatically sends `CRON_SECRET` as a bearer token to authenticate it.
4. After the first deploy, run the import script locally against your production `DATABASE_URL` (or
   use the `/admin` upload button once deployed) to seed data, then run the instrument sync.

## Architecture

- **Next.js 16 (App Router, TypeScript)**, Tailwind CSS, shadcn/ui, `next-themes` for dark mode,
  `recharts` for the AUM trend charts.
- **Drizzle ORM + Neon serverless Postgres** — `neon-http` driver for fast read-heavy routes,
  `neon-serverless` (pooled) driver for the one path that needs real transactions (import).
- **Excel parsing**: `xlsx` (SheetJS), reading fixed row/column offsets verified against the real
  workbook, with a fallback header-row scanner that throws loudly if a future export shifts rows.
- **DHAN integration**: `src/lib/dhan/` — instrument-master sync (ISIN → security ID, refreshed
  manually), and a batched/chunked LTP client that degrades to fallback pricing on any failure rather
  than breaking the whole computation.
- **Finnhub + ExchangeRate-API integration**: `src/lib/finnhub/`, `src/lib/fx/`, `src/lib/aum/foreign-pricing.ts`
  — prices the ~169 US-listed holdings independently of DHAN, refreshed daily via GitHub Actions.
- **Live AUM engine**: `src/lib/aum/compute-live-aum.ts` — dedupes ISINs across all AMCs before
  calling DHAN (a stock held by 40 funds is priced once, not 40 times), caches the result in-memory
  for ~45s, and writes an idempotent daily snapshot as a side effect.
- **Historical backfill**: `src/lib/aum/backfill.ts` used DHAN's historical EOD-close API to fill in
  daily AUM for every trading day between the last report period and whenever live collection started,
  so the "Avg AUM since last report" figure and trend charts aren't limited to just a few days of data.

## Built features

- Excel import (CLI + admin upload) with multi-month history retention
- Live pricing: DHAN for domestic equities, Finnhub + FX conversion for US-listed holdings
- Overview page: sortable table (live AUM, average AUM since last report, reported AUM, holdings/debt/live-priced
  counts), industry AUM trend chart, Live/Closed market-hours badge, search
- AMC detail page: holdings table, sector allocation, AUM trend chart
- Daily AUM snapshots (Vercel Cron) + one-time historical backfill
- Admin settings page (DHAN token, instrument sync, Excel upload), dark mode, auto-refresh

Deliberately deferred:

- CSV/Excel export
- "Top movers" (stocks impacting AUM most)
- Cross-AMC sector exposure page
- Pricing for non-US foreign holdings (Taiwan, Japan, etc. — ~137 holdings, remain on last-reported value)

## Known limitations

- The in-memory live-AUM cache is per serverless instance, not shared — acceptable for personal-scale
  traffic (worst case is one extra DHAN call, never incorrect data).
- `data/amc-name-map.json` is a manually curated mapping between Overview names and sheet tab names
  (they don't match 1:1, especially for SIF products). If a future export renames or adds/removes an
  AMC, the importer will fail loudly rather than silently dropping data — update that file to match.
