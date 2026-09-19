import { and, desc, eq, gte, lte, ne } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings, importLog, liveAumDailySnapshot } from "../db/schema";
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

// Finds the most recent importLog row for a report period and applies a
// reclaim outcome to it -- shared by the automatic post-import trigger
// (runPostImportReclaim, which already has an exact row id) and the manual
// "Recalculate live AUM" button (which only learns the period after
// reclaimForwardGap() itself resolves), so a manual re-run after an
// automatic failure correctly clears the banner instead of leaving a stale
// 'failed' status showing forever.
export async function setReclaimStatusForPeriod(
  reportPeriod: string,
  status: "success" | "failed",
  error: string | null
): Promise<void> {
  const [latest] = await db
    .select({ id: importLog.id })
    .from(importLog)
    .where(eq(importLog.reportPeriod, reportPeriod))
    .orderBy(desc(importLog.id))
    .limit(1);
  if (!latest) return;
  await db
    .update(importLog)
    .set({ reclaimStatus: status, reclaimError: error, reclaimCompletedAt: new Date() })
    .where(eq(importLog.id, latest.id));
}

export interface PostImportReclaimOutcome {
  status: "success" | "failed";
  error?: string;
  result?: ReclaimForwardGapResult;
}

/**
 * Runs reclaimForwardGap() as a tracked follow-up to a specific import,
 * recording its outcome on that same importLog row ('pending' immediately,
 * then 'success'/'failed') so a failure is visible on the Admin page rather
 * than silently lost -- shared by both entry points that can trigger a
 * genuine new-period import (the Admin upload route, via Next's `after()`,
 * and the CLI script `scripts/import-excel.ts`, run inline) so neither one
 * can reintroduce the "forgot to reclaim" gap this was built to close.
 * Never throws -- both callers just inspect the returned status.
 */
export async function runPostImportReclaim(importLogId: number): Promise<PostImportReclaimOutcome> {
  await db.update(importLog).set({ reclaimStatus: "pending" }).where(eq(importLog.id, importLogId));
  try {
    const result = await reclaimForwardGap();
    await db
      .update(importLog)
      .set({ reclaimStatus: "success", reclaimError: null, reclaimCompletedAt: new Date() })
      .where(eq(importLog.id, importLogId));
    return { status: "success", result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(importLog)
      .set({ reclaimStatus: "failed", reclaimError: message, reclaimCompletedAt: new Date() })
      .where(eq(importLog.id, importLogId));
    return { status: "failed", error: message };
  }
}
