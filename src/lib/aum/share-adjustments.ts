import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { isinShareAdjustment } from "../db/schema";

export interface ShareAdjustment {
  multiplier: number;
  firstDetectedOn: string;
  lastPriceBeforeInr: number;
  lastPriceAfterInr: number;
}

/**
 * Every currently-active (non-dismissed) share adjustment for a report
 * period, keyed by ISIN -- read side consumed by compute-live-aum.ts to
 * correct holdings.shares (never mutated) at live-compute time. Naturally
 * scoped/invalidated by reportPeriod: once current_report_period advances to
 * a period whose holdings.shares is presumably already correct/post-split,
 * this query simply stops returning the old period's rows.
 */
export async function getActiveShareMultipliers(reportPeriod: string): Promise<Map<string, ShareAdjustment>> {
  const rows = await db
    .select()
    .from(isinShareAdjustment)
    .where(and(eq(isinShareAdjustment.reportPeriod, reportPeriod), isNull(isinShareAdjustment.dismissedAt)));

  const map = new Map<string, ShareAdjustment>();
  for (const r of rows) {
    map.set(r.isin, {
      multiplier: Number(r.effectiveMultiplier),
      firstDetectedOn: r.firstDetectedOn,
      lastPriceBeforeInr: Number(r.lastPriceBeforeInr),
      lastPriceAfterInr: Number(r.lastPriceAfterInr),
    });
  }
  return map;
}

/**
 * Admin override for a wrong auto-detection (e.g. a coincidental
 * price-ratio match that wasn't really a split). Doesn't delete the row --
 * keeps it as a dismissed record so split-detection.ts's log-then-check flow
 * knows not to resurrect it automatically on a future re-run.
 */
export async function dismissShareAdjustment(isin: string, reportPeriod: string, reason: string): Promise<void> {
  await db
    .update(isinShareAdjustment)
    .set({ dismissedAt: new Date(), dismissedReason: reason, updatedAt: new Date() })
    .where(and(eq(isinShareAdjustment.isin, isin), eq(isinShareAdjustment.reportPeriod, reportPeriod)));
}
