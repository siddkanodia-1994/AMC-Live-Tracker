import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings, holdings, isinShareAdjustment, isinShareAdjustmentLog } from "../db/schema";
import { getIsinPricesBeforeDate, getIsinPricesForDate } from "./history";

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";
const TOLERANCE_KEY = "split_detection_tolerance_pct";
const DEFAULT_TOLERANCE_PCT = 0.08;

// Common corporate-action ratios -- forward splits/bonus issues (price
// falls, share count rises) tested directly; reverse splits/consolidations
// (price rises, share count falls) tested against the reciprocal. ±8%
// tolerance is deliberately generous enough to cover ordinary post-split
// first-day volatility (the real Jupiter Life Line case was 4.872 vs a
// clean 5.0 -- 2.56% deviation) without being so wide it starts treating
// unrelated crashes as splits. That risk can't be fully removed by
// tolerance tuning alone -- see getActiveShareMultipliers/the UI layer for
// why every detection stays visible and reversible rather than silently
// auto-applied.
const FORWARD_CANDIDATE_RATIOS = [2, 3, 4, 5, 10, 20, 25, 50, 100];

async function getCurrentReportPeriod(): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, CURRENT_REPORT_PERIOD_KEY));
  return row?.value ?? null;
}

export async function getSplitDetectionTolerancePct(): Promise<number> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, TOLERANCE_KEY));
  const parsed = row ? Number.parseFloat(row.value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOLERANCE_PCT;
}

interface RatioMatch {
  matchedRatio: number; // shares multiplier (>1 forward split, <1 reverse split)
  deviationPct: number;
}

function findClosestRatioMatch(rawRatio: number, tolerancePct: number): RatioMatch | null {
  // rawRatio = priceBefore / priceAfter. >1 means price fell (forward split/
  // bonus -- shares multiply by the matched ratio). <1 means price rose
  // (reverse split/consolidation -- shares multiply by 1/matched).
  const testRatio = rawRatio >= 1 ? rawRatio : 1 / rawRatio;
  let best: RatioMatch | null = null;
  for (const candidate of FORWARD_CANDIDATE_RATIOS) {
    const deviationPct = Math.abs(testRatio - candidate) / candidate;
    if (deviationPct <= tolerancePct && (best === null || deviationPct < best.deviationPct)) {
      best = { matchedRatio: candidate, deviationPct };
    }
  }
  if (best === null) return null;
  // Translate back to a shares multiplier in the original (before/after) direction.
  const sharesMultiplier = rawRatio >= 1 ? best.matchedRatio : 1 / best.matchedRatio;
  return { matchedRatio: sharesMultiplier, deviationPct: best.deviationPct };
}

export interface DetectShareAdjustmentsResult {
  detectedCount: number;
}

/**
 * Compares `date`'s close against the closest prior close for every
 * currently-priceable ISIN, looking for a clean-ratio jump matching a common
 * split/bonus/reverse-split pattern. Date-parameterized (not hardcoded to
 * "today") so the same function serves both the daily cron's real-time run
 * and a retroactive admin-triggered backfill for a split that already
 * happened before this shipped. Idempotent per (isin, reportPeriod, date) via
 * isinShareAdjustmentLog's unique index -- safe to call repeatedly for the
 * same date.
 */
export async function detectShareAdjustments(date: string): Promise<DetectShareAdjustmentsResult> {
  const reportPeriod = await getCurrentReportPeriod();
  if (!reportPeriod) return { detectedCount: 0 };

  const priceableHoldings = await db
    .selectDistinctOn([holdings.isin], { isin: holdings.isin })
    .from(holdings)
    .where(and(eq(holdings.reportPeriod, reportPeriod), eq(holdings.isPriceable, true), isNotNull(holdings.isin)));

  const priceableIsins = priceableHoldings.map((h) => h.isin as string);
  if (priceableIsins.length === 0) return { detectedCount: 0 };

  const [todayPrices, priorPrices, tolerancePct] = await Promise.all([
    getIsinPricesForDate(date),
    getIsinPricesBeforeDate(date),
    getSplitDetectionTolerancePct(),
  ]);

  let detectedCount = 0;

  for (const isin of priceableIsins) {
    const priceAfter = todayPrices.get(isin);
    const priceBefore = priorPrices.get(isin);
    if (priceAfter === undefined || priceBefore === undefined || priceAfter <= 0 || priceBefore <= 0) continue;

    const rawRatio = priceBefore / priceAfter;
    if (Math.abs(rawRatio - 1) < 0.01) continue; // ordinary day, no meaningful move

    const match = findClosestRatioMatch(rawRatio, tolerancePct);
    if (!match) continue;

    const inserted = await db
      .insert(isinShareAdjustmentLog)
      .values({
        isin,
        reportPeriod,
        detectedOn: date,
        priceBeforeInr: String(priceBefore),
        priceAfterInr: String(priceAfter),
        rawRatio: String(rawRatio),
        matchedRatio: String(match.matchedRatio),
        deviationPct: String(match.deviationPct),
      })
      .onConflictDoNothing({ target: [isinShareAdjustmentLog.isin, isinShareAdjustmentLog.reportPeriod, isinShareAdjustmentLog.detectedOn] })
      .returning({ id: isinShareAdjustmentLog.id });

    if (inserted.length === 0) continue; // already processed this (isin, reportPeriod, date)
    detectedCount++;

    const [existing] = await db
      .select()
      .from(isinShareAdjustment)
      .where(and(eq(isinShareAdjustment.isin, isin), eq(isinShareAdjustment.reportPeriod, reportPeriod)));

    if (!existing) {
      await db.insert(isinShareAdjustment).values({
        isin,
        reportPeriod,
        effectiveMultiplier: String(match.matchedRatio),
        firstDetectedOn: date,
        lastDetectedOn: date,
        detectionCount: 1,
        lastPriceBeforeInr: String(priceBefore),
        lastPriceAfterInr: String(priceAfter),
      });
    } else if (!existing.dismissedAt) {
      const compounded = Number(existing.effectiveMultiplier) * match.matchedRatio;
      await db
        .update(isinShareAdjustment)
        .set({
          effectiveMultiplier: String(compounded),
          lastDetectedOn: date,
          detectionCount: existing.detectionCount + 1,
          lastPriceBeforeInr: String(priceBefore),
          lastPriceAfterInr: String(priceAfter),
          updatedAt: new Date(),
        })
        .where(eq(isinShareAdjustment.id, existing.id));
    }
    // existing dismissed row: log event already recorded above, but a human
    // already said this ISIN's move for this period wasn't real -- don't
    // resurrect it automatically.
  }

  return { detectedCount };
}
