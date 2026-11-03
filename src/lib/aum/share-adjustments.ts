import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { isinShareAdjustment } from "../db/schema";
import type { HistoricalClose } from "../dhan/historical-client";

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
    map.set(r.isin, toShareAdjustment(r));
  }
  return map;
}

function toShareAdjustment(r: typeof isinShareAdjustment.$inferSelect): ShareAdjustment {
  return {
    multiplier: Number(r.effectiveMultiplier),
    firstDetectedOn: r.firstDetectedOn,
    lastPriceBeforeInr: Number(r.lastPriceBeforeInr),
    lastPriceAfterInr: Number(r.lastPriceAfterInr),
  };
}

/**
 * Same as getActiveShareMultipliers, but for several report periods in one
 * query -- reportPeriod -> isin -> adjustment. For the historical
 * recomputation paths (backfill.ts, outage-reclaim.ts), which can price
 * holdings from more than one period for the same date.
 */
export async function getActiveShareMultipliersByPeriod(
  reportPeriods: string[]
): Promise<Map<string, Map<string, ShareAdjustment>>> {
  const byPeriod = new Map<string, Map<string, ShareAdjustment>>();
  if (reportPeriods.length === 0) return byPeriod;
  const rows = await db
    .select()
    .from(isinShareAdjustment)
    .where(and(inArray(isinShareAdjustment.reportPeriod, reportPeriods), isNull(isinShareAdjustment.dismissedAt)));
  for (const r of rows) {
    const map = byPeriod.get(r.reportPeriod) ?? new Map<string, ShareAdjustment>();
    map.set(r.isin, toShareAdjustment(r));
    byPeriod.set(r.reportPeriod, map);
  }
  return byPeriod;
}

/**
 * Every active split/bonus event, keyed by ISIN, regardless of report
 * period -- a split is a security-level fact, so un-adjusting a historical
 * price series (toAsTradedCloses below) doesn't depend on which period's
 * holdings it'll later be multiplied against. Unfiltered by ISIN on
 * purpose: the table holds one row per detected split, so it's far smaller
 * than any priceable-ISIN list a caller would pass in.
 */
export async function getActiveShareAdjustmentEventsByIsin(): Promise<Map<string, ShareAdjustment[]>> {
  const byIsin = new Map<string, ShareAdjustment[]>();
  const rows = await db.select().from(isinShareAdjustment).where(isNull(isinShareAdjustment.dismissedAt));
  for (const r of rows) {
    const list = byIsin.get(r.isin) ?? [];
    // The same event can be logged under more than one report period.
    if (!list.some((a) => a.firstDetectedOn === r.firstDetectedOn)) list.push(toShareAdjustment(r));
    byIsin.set(r.isin, list);
  }
  return byIsin;
}

/**
 * Shares to price a holding with on `date` -- the multiplier applies only
 * on/after the date the split was first detected, exactly like
 * amc-as-of.ts's per-date gating: before that, holdings.shares and the
 * as-traded price were both genuinely pre-split.
 */
export function effectiveSharesForDate(shares: number, adjustment: ShareAdjustment | undefined, date: string): number {
  return adjustment && date >= adjustment.firstDetectedOn ? shares * adjustment.multiplier : shares;
}

/**
 * DHAN's historical endpoint returns split-ADJUSTED closes: once a split
 * has happened, every pre-split day comes back already divided by the
 * split ratio (verified 2026-11-03 on JSW Dulux's 10:1 split: 2026-10-12
 * came back as 305.1, against the 3051.0 actually traded and captured live
 * that day). isin_daily_price and every consumer of it (the live path's
 * last-close fallback, amc-as-of.ts, effectiveSharesForDate above) assume
 * as-traded prices, so a pre-split close is re-multiplied here before it's
 * used or stored.
 *
 * Only converted when the close is actually on the post-split basis --
 * i.e. closer (in log terms) to lastPriceBeforeInr once multiplied than as
 * returned -- so a series fetched before DHAN applied its adjustment, or an
 * already-as-traded stored price, passes through unchanged (idempotent).
 */
export function toAsTradedCloses(closes: HistoricalClose[], adjustments: ShareAdjustment[] | undefined): HistoricalClose[] {
  if (!adjustments || adjustments.length === 0) return closes;
  // Newest split first: each event's lastPriceBeforeInr is on the basis left
  // by every older event, so undoing them in reverse order compares like
  // with like.
  const newestFirst = [...adjustments].sort((a, b) => b.firstDetectedOn.localeCompare(a.firstDetectedOn));
  return closes.map((c) => {
    let close = c.close;
    for (const adj of newestFirst) {
      if (c.date >= adj.firstDetectedOn || close <= 0 || adj.lastPriceBeforeInr <= 0 || adj.multiplier <= 0) continue;
      const distanceAsReturned = Math.abs(Math.log(close / adj.lastPriceBeforeInr));
      const distanceIfAdjusted = Math.abs(Math.log((close * adj.multiplier) / adj.lastPriceBeforeInr));
      if (distanceIfAdjusted < distanceAsReturned) close *= adj.multiplier;
    }
    return close === c.close ? c : { date: c.date, close };
  });
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
