import { and, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings, liveAumDailySnapshot } from "../db/schema";
import { syncInstrumentMap, type SyncInstrumentMapResult } from "../dhan/instrument-master";
import { backfillDailySnapshots, yesterdayIst, type BackfillResult } from "./backfill";
import { invalidateLiveAumCache } from "./cache";
import { upsertDailyDataQuality } from "./daily-data-quality";
import { firstDayOfNextMonth } from "./report-period";

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";

export interface ReclaimForwardGapResult {
  reportPeriod: string;
  fromDate: string;
  toDate: string;
  nothingToReclaim: boolean;
  instrumentSync: SyncInstrumentMapResult | null;
  displacedRowsDeleted: number;
  backfill: BackfillResult | null;
  dailyDataQualityDatesProcessed: number;
  warnings: string[];
}

/**
 * Makes the current report period canonical for every day already elapsed
 * in its own forward gap (firstDayOfNextMonth(reportPeriod) .. yesterday).
 *
 * Uploading a new month does NOT do this automatically: liveAumDailySnapshot
 * uses "first claim wins" for canonical ownership of a date (see
 * backfill.ts), so if the prior period's own forward-gap backfill (or the
 * daily cron, running day by day under the old holdings) already claimed
 * those dates, the newly-uploaded period's backfill only ever lands as
 * non-canonical comparison rows -- Overview/Daily Data etc. keep showing
 * the OLD period's holdings composition for days that have already elapsed
 * under the NEW period. This is the exact bug found and manually fixed
 * once this session (deleting 1,080 stale rows for July 1-14); this
 * function is that fix made repeatable via an Admin button.
 */
export async function reclaimForwardGap(): Promise<ReclaimForwardGapResult> {
  const [periodRow] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, CURRENT_REPORT_PERIOD_KEY));
  if (!periodRow) throw new Error("No report period configured — import a workbook first.");
  const reportPeriod = periodRow.value;

  const fromDate = firstDayOfNextMonth(reportPeriod);
  const toDate = yesterdayIst();

  if (fromDate > toDate) {
    return {
      reportPeriod,
      fromDate,
      toDate,
      nothingToReclaim: true,
      instrumentSync: null,
      displacedRowsDeleted: 0,
      backfill: null,
      dailyDataQualityDatesProcessed: 0,
      warnings: ["Nothing to reclaim yet — the current period's forward gap hasn't started."],
    };
  }

  const instrumentSync = await syncInstrumentMap();

  // Clear the displaced old-period rows (both canonical and comparison) for
  // this date range so the fresh backfill below can claim canonical status
  // -- an onConflictDoNothing insert would otherwise silently no-op against
  // rows that already exist for this period, and leftover other-period rows
  // would keep "first claim wins" ownership forever.
  const deleted = await db
    .delete(liveAumDailySnapshot)
    .where(
      and(
        gte(liveAumDailySnapshot.snapshotDate, fromDate),
        lte(liveAumDailySnapshot.snapshotDate, toDate),
        ne(liveAumDailySnapshot.reportPeriod, reportPeriod)
      )
    )
    .returning({ id: liveAumDailySnapshot.id });

  const backfill = await backfillDailySnapshots({ reportPeriod, fromDate, toDate });

  let dailyDataQualityDatesProcessed = 0;
  let date = fromDate;
  while (date <= toDate) {
    await upsertDailyDataQuality(date);
    dailyDataQualityDatesProcessed++;
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }

  invalidateLiveAumCache();

  return {
    reportPeriod,
    fromDate,
    toDate,
    nothingToReclaim: false,
    instrumentSync,
    displacedRowsDeleted: deleted.length,
    backfill,
    dailyDataQualityDatesProcessed,
    warnings: backfill.warnings,
  };
}
