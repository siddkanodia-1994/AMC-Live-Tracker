// Re-backfills the entire canonical live-AUM history in small, cautious
// windows -- 15 trading days at a time, 60s cooldown between windows --
// using the hardened historical-client.ts (logging + retry + slower
// pacing). Exists because a prior full-history backfill (one continuous
// run per period, ~1000+ sequential requests) silently lost ~20-25% of
// real, available DHAN data to some transient failure that was never
// logged or retried -- confirmed by re-testing failed ISINs individually,
// which succeeded almost every time. This script fixes that by never
// running one long continuous burst against DHAN again.
//
// For each report period with canonical liveAumDailySnapshot rows, its
// trading dates are auto-discovered and split into 15-day windows. Each
// window's existing canonical rows are deleted first (the underlying
// insert is onConflictDoNothing, so a stale/incomplete row must be
// cleared before a corrected one can be written), then
// backfillDailySnapshots re-runs scoped to just that window -- its
// existing fullyCoveredIsins check (against isin_daily_price, never
// deleted) means only genuinely-missing ISINs get re-fetched, not
// everything every time. Safe to interrupt and resume: every write is
// idempotent, and already-complete windows will simply have nothing left
// to fetch.
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { liveAumDailySnapshot } from "../src/lib/db/schema";
import { backfillDailySnapshots } from "../src/lib/aum/backfill";
import { getIstDateString } from "../src/lib/utils/date";

const WINDOW_SIZE = 15;
const COOLDOWN_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const periodRows = await db
    .selectDistinct({ reportPeriod: liveAumDailySnapshot.reportPeriod })
    .from(liveAumDailySnapshot)
    .where(eq(liveAumDailySnapshot.isCanonical, true));
  const reportPeriods = periodRows.map((r) => r.reportPeriod).sort();

  console.log(`Found ${reportPeriods.length} report periods with canonical history: ${reportPeriods.join(", ")}`);

  // Today is deliberately excluded -- its canonical status is owned by the
  // live market-hours compute path (compute-live-aum.ts), not the
  // historical backfill path, which explicitly refuses to claim canonical
  // ownership of "today" itself (see backfillDailySnapshots' own
  // `date < todayIst` check). Including it here would delete today's
  // already-canonical row and replace it with a non-canonical one that
  // nothing else knows how to re-promote -- hit this exact bug once
  // already during testing.
  const todayIst = getIstDateString();

  const windows: { reportPeriod: string; dates: string[] }[] = [];
  for (const reportPeriod of reportPeriods) {
    const dateRows = await db
      .selectDistinct({ date: liveAumDailySnapshot.snapshotDate })
      .from(liveAumDailySnapshot)
      .where(and(eq(liveAumDailySnapshot.reportPeriod, reportPeriod), eq(liveAumDailySnapshot.isCanonical, true)))
      .orderBy(asc(liveAumDailySnapshot.snapshotDate));
    const dates = dateRows.map((r) => r.date).filter((d) => d < todayIst);
    for (const w of chunk(dates, WINDOW_SIZE)) windows.push({ reportPeriod, dates: w });
  }

  console.log(`Split into ${windows.length} windows of up to ${WINDOW_SIZE} trading days each.\n`);

  for (let i = 0; i < windows.length; i++) {
    const { reportPeriod, dates } = windows[i];
    const fromDate = dates[0];
    const toDate = dates[dates.length - 1];
    console.log(`--- Window ${i + 1}/${windows.length}: reportPeriod=${reportPeriod} ${fromDate}..${toDate} (${dates.length} days) ---`);

    const deleted = await db
      .delete(liveAumDailySnapshot)
      .where(
        and(
          eq(liveAumDailySnapshot.reportPeriod, reportPeriod),
          eq(liveAumDailySnapshot.isCanonical, true),
          inArray(liveAumDailySnapshot.snapshotDate, dates)
        )
      )
      .returning({ id: liveAumDailySnapshot.id });
    console.log(`  Deleted ${deleted.length} existing canonical rows for this window.`);

    const result = await backfillDailySnapshots({ reportPeriod, fromDate, toDate });
    console.log(
      `  Backfill result: tradingDatesFound=${result.tradingDatesFound} rowsInserted=${result.rowsInserted} (canonical=${result.canonicalRowsInserted} comparison=${result.comparisonRowsInserted})`
    );
    for (const w of result.warnings) console.log(`  Warning: ${w}`);

    if (i < windows.length - 1) {
      console.log(`  Cooling down ${COOLDOWN_MS / 1000}s before next window...\n`);
      await sleep(COOLDOWN_MS);
    }
  }

  console.log("\nDone. All windows processed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Chunked re-backfill failed:", err);
  process.exit(1);
});
