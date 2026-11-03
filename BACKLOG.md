# Backlog

Input for the `backlog` workflow (`.claude/workflows/backlog.js`). It reads only **Ready**, splits the items
into lanes that touch disjoint files, and runs `dev-loop` on every lane in parallel worktrees. Each lane
ends as a branch for you to merge. Move items between sections by hand. Done items can be deleted once
merged.

## Ready

<!-- One code task per bullet: what to change and how to know it's right. -->

## In progress

- Overview headline first-render flash (session `headline-flash`, branch `claude/headline-flash-*`)
- Classify unpriced Indian instruments + `instrument-map-gaps` probe check (session `instrument-gaps`)

## Blocked / needs you

- **2027 NSE holiday list:** add to `src/lib/utils/market-hours.ts` once NSE publishes it (usually mid-December). The probe warns from 1 Dec.
- **Oct-26 Mirae tracker:** run the `ingest` workflow on it after the 15th of November, then import via /admin.
- **Daily data-ops schedule:** create a weekday 17:15 IST Claude Code scheduled task that runs the `data-ops` workflow (agent creation of scheduled tasks is blocked).
- **GitHub PAT** in `~/.claude/settings.json`: revoke it.
- **Optional:** add `AMC_SCORE_SUPABASE_URL` / `AMC_SCORE_SUPABASE_KEY` as GitHub Actions secrets so the probe checks the AMC Score loader.

## Done (2026-11-03)

- Secrets guard, 2027-safe holiday map, US price staleness tiers, cron ledger + 18:05 retry, ops probe, Agent Ops panel
- ETF split idempotency, import dry-run, backfill split/US parity, Bansal Wire split carry-forward, Oct history recompute
- 9 unpriced US holdings mapped (162/163 priced), lint debt cleared, anon Supabase key in production
