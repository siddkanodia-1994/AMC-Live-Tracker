// AMC Analytics' Ratio / Regression stat strip: the price-vs-AUM Corr / R²
// at the sections' own Range, Moving avg, AUM-only avg and Levels choices.
// Same pipeline as the Stock Correlation table's computeRow (moving average
// over the full history, Extra Lag, one range cutoff from the AUM series,
// then returns or levels), so the figures match that table and the chart's
// Absolute-view caption for the same settings.

import {
  computeCorrelationStats,
  computeLevelCorrelationStats,
  computeMovingAverage,
  lagSeriesForward,
  trimToLastContinuousRun,
  type CorrelationStats,
} from "../aum/series-math";
import { computeRangeCutoffDate, filterByCutoff, type RangeOption } from "../aum/date-range";
import type { AumHistoryPoint, AmcStockPricePoint } from "../aum/history";

export interface FitStatsOptions {
  maDays: number;
  range: RangeOption;
  /** Average AUM only; the price stays raw. */
  aumOnlyAveraging: boolean;
  /** Correlate the raw levels instead of their day-over-day % change. */
  levelsCorrelation: boolean;
  extraLagDays: number;
}

type Dated = { date: string; value: number };

export function computeFitCorrelation(
  aumHistory: AumHistoryPoint[],
  priceSeries: AmcStockPricePoint[],
  opts: FitStatsOptions
): CorrelationStats | null {
  const data = trimToLastContinuousRun(aumHistory);
  if (data.length === 0 || priceSeries.length === 0) return null;
  const aumMa = computeMovingAverage(
    data.map((d) => d.liveAumCr),
    opts.maDays
  );
  const priceShown = opts.aumOnlyAveraging
    ? priceSeries.map((p) => p.priceInr as number | undefined)
    : computeMovingAverage(
        priceSeries.map((p) => p.priceInr),
        opts.maDays
      );
  const aumFull = lagSeriesForward(
    data.map((d, i) => ({ date: d.date, value: aumMa[i] })),
    opts.extraLagDays
  );
  const priceFull = priceSeries.map((p, i) => ({ date: p.date, value: priceShown[i] }));
  const cutoff = computeRangeCutoffDate(aumFull, opts.range);
  const aum = filterByCutoff(aumFull, cutoff).filter((d): d is Dated => d.value !== undefined);
  const price = filterByCutoff(priceFull, cutoff).filter((d): d is Dated => d.value !== undefined);
  return opts.levelsCorrelation ? computeLevelCorrelationStats(aum, price) : computeCorrelationStats(aum, price);
}

export type FitStrength = "strong" | "moderate" | "weak";

/** |r| ≥ 0.7 strong, ≥ 0.4 moderate, below that weak. */
export function fitStrength(r: number | null | undefined): FitStrength | null {
  if (r == null || !Number.isFinite(r)) return null;
  const a = Math.abs(r);
  return a >= 0.7 ? "strong" : a >= 0.4 ? "moderate" : "weak";
}
