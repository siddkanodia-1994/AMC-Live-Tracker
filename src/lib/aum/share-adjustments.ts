import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { holdings, isinShareAdjustment } from "../db/schema";
import { CRORE } from "../utils/constants";
import { firstDayOfNextMonth } from "./report-period";
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
 * correct holdings.shares (never mutated) at live-compute time. Includes
 * splits recorded under an EARLIER period that still apply to this one (see
 * getActiveShareMultipliersByPeriod).
 */
export async function getActiveShareMultipliers(reportPeriod: string): Promise<Map<string, ShareAdjustment>> {
  return (await getActiveShareMultipliersByPeriod([reportPeriod])).get(reportPeriod) ?? new Map();
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
 * Whether a period's holdings are still on the PRE-split share basis for
 * `adj`, judged from that period's own implied price (Σ market value ÷ Σ
 * shares): closer, in log terms, to the last pre-split close than to the
 * first post-split one. Needed because vendor files differ -- e.g. the
 * Sep-26 tracker reported Mold-Tek's shares already doubled for its 9 Oct
 * 2:1 split (implied ₹330 vs ₹652 before / ₹326 after), but Bansal Wire's
 * still pre-split for its 16 Oct 5:1 (implied ₹323 vs ₹316 / ₹62).
 */
export function isOnPreSplitBasis(impliedPriceInr: number, adj: ShareAdjustment): boolean {
  if (!(impliedPriceInr > 0) || !(adj.lastPriceBeforeInr > 0) || !(adj.lastPriceAfterInr > 0)) return false;
  return Math.abs(Math.log(impliedPriceInr / adj.lastPriceBeforeInr)) < Math.abs(Math.log(impliedPriceInr / adj.lastPriceAfterInr));
}

/**
 * Active adjustments for several report periods in one pass -- reportPeriod
 * -> isin -> adjustment. Used directly by the historical recomputation paths
 * (backfill.ts, outage-reclaim.ts), which can price holdings from more than
 * one period for the same date, and via getActiveShareMultipliers by the
 * live path.
 *
 * A split is detected (split-detection.ts) under whichever period is
 * current on the day the price jumps. If the NEXT period's file is imported
 * afterwards but its holdings date (month end) precedes the split, those
 * holdings are still pre-split too -- yet a lookup keyed on its own period
 * alone would never see the adjustment (Bansal Wire, 16 Oct 2026: recorded
 * under 2026-08, so the 2026-09 holdings were valued at a fifth of their
 * worth). So an earlier period's adjustment is carried forward to period P
 * when it was first detected after P's month end AND P's own holdings are
 * still on the pre-split basis (isOnPreSplitBasis). P's own rows win.
 */
export async function getActiveShareMultipliersByPeriod(
  reportPeriods: string[]
): Promise<Map<string, Map<string, ShareAdjustment>>> {
  const byPeriod = new Map<string, Map<string, ShareAdjustment>>();
  if (reportPeriods.length === 0) return byPeriod;
  const latestPeriod = [...reportPeriods].sort().at(-1)!;
  // Small table (one row per detected split), so one unfiltered-by-period
  // read covers both own-period rows and carry-forward candidates.
  const rows = await db
    .select()
    .from(isinShareAdjustment)
    .where(and(lte(isinShareAdjustment.reportPeriod, latestPeriod), isNull(isinShareAdjustment.dismissedAt)));
  for (const r of rows) {
    if (!reportPeriods.includes(r.reportPeriod)) continue;
    const map = byPeriod.get(r.reportPeriod) ?? new Map<string, ShareAdjustment>();
    map.set(r.isin, toShareAdjustment(r));
    byPeriod.set(r.reportPeriod, map);
  }

  for (const period of reportPeriods) {
    const holdingsDateEnd = firstDayOfNextMonth(period);
    const own = byPeriod.get(period);
    const candidates = rows.filter(
      (r) => r.reportPeriod < period && r.firstDetectedOn >= holdingsDateEnd && !own?.has(r.isin)
    );
    if (candidates.length === 0) continue;
    const isins = [...new Set(candidates.map((c) => c.isin))];
    const implied = await db
      .select({
        isin: holdings.isin,
        mv: sql<string>`sum(${holdings.marketValueCr})`,
        shares: sql<string>`sum(${holdings.shares})`,
      })
      .from(holdings)
      .where(and(eq(holdings.reportPeriod, period), inArray(holdings.isin, isins)))
      .groupBy(holdings.isin);
    const impliedPriceByIsin = new Map(
      implied.map((r) => [r.isin, Number(r.shares) > 0 ? (Number(r.mv) * CRORE) / Number(r.shares) : 0])
    );
    for (const isin of isins) {
      // If one ISIN somehow has several later splits, the most recent one
      // still on the pre-split basis is what this period's shares need.
      const adjs = candidates
        .filter((c) => c.isin === isin)
        .map(toShareAdjustment)
        .sort((a, b) => b.firstDetectedOn.localeCompare(a.firstDetectedOn));
      const price = impliedPriceByIsin.get(isin) ?? 0;
      const applicable = adjs.find((a) => isOnPreSplitBasis(price, a));
      if (!applicable) continue;
      const map = byPeriod.get(period) ?? new Map<string, ShareAdjustment>();
      map.set(isin, applicable);
      byPeriod.set(period, map);
    }
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
