# Backlog

Input for the `backlog` workflow (`.claude/workflows/backlog.js`). It reads only **Ready**, splits the items
into lanes that touch disjoint files, and runs `dev-loop` on every lane in parallel worktrees. Each lane
ends as a branch for you to merge. Move items between sections by hand. Done items can be deleted once
merged.

## Ready

<!-- One code task per bullet: what to change and how to know it's right. -->

## In progress

<!-- nothing in flight -->

## Blocked / needs you

- **HEG Graphite (₹616 cr, 7 AMCs):** demerged from HEG and not yet listed, so it sits at reported value. It maps automatically on its first trading day; the `instrument-map-gaps` probe check warns until then. See `docs/instrument-gaps-2026-11.md`.

- **2027 NSE holiday list:** add to `src/lib/utils/market-hours.ts` once NSE publishes it (usually mid-December). The probe warns from 1 Dec.
- **Oct-26 Mirae tracker:** run the `ingest` workflow on it after the 15th of November, then import via /admin.
- **Daily data-ops schedule:** create a weekday 17:15 IST Claude Code scheduled task that runs the `data-ops` workflow (agent creation of scheduled tasks is blocked).
- **GitHub PAT** in `~/.claude/settings.json`: revoke it.
- **Optional:** add `AMC_SCORE_SUPABASE_URL` / `AMC_SCORE_SUPABASE_KEY` as GitHub Actions secrets so the probe checks the AMC Score loader.

## Done (2026-11-03)

- Secrets guard, 2027-safe holiday map, US price staleness tiers, cron ledger + 18:05 retry, ops probe, Agent Ops panel
- ETF split idempotency, import dry-run, backfill split/US parity, Bansal Wire split carry-forward, Oct history recompute
- 9 unpriced US holdings mapped (162/163 priced), lint debt cleared, anon Supabase key in production
- Parallel agent graph (backlog lanes, DHAN ∥ Finnhub repair lanes, tiered roles), Overview first-render flash fixed, instrument-gap audit and probe check, 2 stuck mappings muted
