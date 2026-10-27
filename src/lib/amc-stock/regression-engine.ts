// AMC-aware glue between the raw AUM/price history this app already
// fetches and the pure stats in src/lib/aum/regression.ts -- mirrors the
// engine/metrics split in src/lib/backtest/ (pure functions over
// pre-fetched data, no I/O of its own).
import type { AumHistoryPoint, AmcStockPricePoint } from "../aum/history";
import {
  computeMovingAverage,
  toDatedValues,
  alignSeriesByDate,
  trimToLastContinuousRun,
  priceToAumRatioStats,
  lagSeriesForward,
  type DatedValue,
} from "../aum/series-math";
import { computeRangeCutoffDate, filterByCutoff, type RangeOption } from "../aum/date-range";
import { fitOls, neweyWestLagCount, neweyWestSlopeTStat, durbinWatson, computeHoldoutBacktest, type HoldoutResult } from "../aum/regression";

export const MA_WINDOW_OPTIONS = [
  { value: 10, label: "10D" },
  { value: 20, label: "20D" },
  { value: 45, label: "45D" },
] as const;
// A plain number, not a literal union of the 3 presets above -- the Stock
// Correlation tab's "Moving avg (days)" control also accepts a free-typed
// custom value, not just these quick-select buttons.
export type MaWindow = number;

export const EXTRA_LAG_OPTIONS = [
  { value: 0, label: "None" },
  { value: 45, label: "45D" },
  { value: 60, label: "60D" },
  { value: 90, label: "90D" },
] as const;
export type ExtraLagDays = (typeof EXTRA_LAG_OPTIONS)[number]["value"];

// The driver is ALWAYS at least 1 trading day stale relative to price --
// you can't trade on today's AUM print before it exists -- with
// extraLagDays on top of that base, never instead of it. Matches the
// reference page's own "revenue lagged one session" baseline. This floor
// is regression-specific -- the Stock Correlation tab's ratio-based
// columns apply extraLagDays directly with NO floor, so "Extra Lag: None"
// stays genuinely zero-lag for them (see lagSeriesForward's own callers
// in stock-correlation-table.tsx).
const BASE_LAG_SESSIONS = 1;

export interface RegressionConfig {
  maWindow: MaWindow;
  extraLagDays: ExtraLagDays;
  range: RangeOption;
}

export interface RegressionChartPoint {
  date: string;
  close: number;
  model: number;
}

export interface RegressionResult {
  n: number;
  slope: number;
  intercept: number;
  r2: number;
  pearsonR: number | null;
  neweyWest: { lags: number; tStat: number };
  durbinWatson: number | null;
  holdout: HoldoutResult | null;
  driverMin: number;
  driverMax: number;
  driverVariationPct: number;
  fittedFrom: string;
  fittedTo: string;
  latestPrice: number;
  latestDriver: number;
  fairValueAtLatest: number;
  estimatedSessionCount: number;
  // Same-day (unlagged) ratio stats for the right-hand "Price / AUM MA"
  // panel -- a different question from the lagged regression ("where
  // does today's own ratio sit vs. its own history"), so computed from
  // the unlagged driver, not the regression's xs.
  ratioMean: number | null;
  ratioStdDev: number | null;
  currentRatio: number | null;
  currentSigma: number | null;
  priceAtMeanRatio: number | null;
  chartPoints: RegressionChartPoint[];
}

function windowedEstimateFlags(trimmed: AumHistoryPoint[], windowDays: number): (boolean | undefined)[] {
  const isEstimate = trimmed.map((d) => d.reportedAumCr === null);
  const result: (boolean | undefined)[] = [];
  let count = 0;
  for (let i = 0; i < isEstimate.length; i++) {
    if (isEstimate[i]) count++;
    if (i >= windowDays && isEstimate[i - windowDays]) count--;
    result.push(i >= windowDays - 1 ? count > 0 : undefined);
  }
  return result;
}

export function computeRegressionResult(
  aumHistory: AumHistoryPoint[],
  priceSeries: AmcStockPricePoint[],
  config: RegressionConfig
): RegressionResult | null {
  const trimmed = trimToLastContinuousRun(aumHistory);
  if (trimmed.length === 0 || priceSeries.length === 0) return null;

  const totalLag = BASE_LAG_SESSIONS + config.extraLagDays;

  const aumMa = computeMovingAverage(
    trimmed.map((d) => d.liveAumCr),
    config.maWindow
  );
  const aumDated = toDatedValues(
    trimmed.map((d) => d.date),
    aumMa
  );
  const laggedDriver = lagSeriesForward(aumDated, totalLag);

  const estimateFlagsRaw = windowedEstimateFlags(trimmed, config.maWindow);
  const estimateFlagDated = toDatedValues(
    trimmed.map((d) => d.date),
    estimateFlagsRaw.map((v) => (v === undefined ? undefined : v ? 1 : 0))
  );
  const laggedEstimateFlag = lagSeriesForward(estimateFlagDated, totalLag);

  const priceDated: DatedValue[] = priceSeries.map((p) => ({ date: p.date, value: p.priceInr }));

  const cutoffDate = computeRangeCutoffDate(laggedDriver, config.range);
  const driverRanged = filterByCutoff(laggedDriver, cutoffDate);
  const priceRanged = filterByCutoff(priceDated, cutoffDate);

  const { xs, ys } = alignSeriesByDate(driverRanged, priceRanged);
  const fit = fitOls(xs, ys);
  if (!fit || fit.n < 2) return null;

  const pearsonRResult = (() => {
    const n = xs.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let cov = 0,
      varX = 0,
      varY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - meanX;
      const dy = ys[i] - meanY;
      cov += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }
    return varX === 0 || varY === 0 ? null : cov / Math.sqrt(varX * varY);
  })();

  const lagCount = neweyWestLagCount(fit.n);
  const nw = neweyWestSlopeTStat(xs, fit.residuals, fit.slope, lagCount);
  const dw = durbinWatson(fit.residuals);
  const holdout = computeHoldoutBacktest(xs, ys);

  const driverMin = Math.min(...xs);
  const driverMax = Math.max(...xs);
  const driverVariationPct = driverMin !== 0 ? ((driverMax - driverMin) / Math.abs(driverMin)) * 100 : 0;

  // The actual fitted/charted dates are the intersection of driverRanged
  // and priceRanged (exactly what alignSeriesByDate -> xs/ys used, which
  // discards dates) -- NOT driverRanged's own full extent. These can
  // differ a lot: the AUM side's pre-2026 estimate reaches back to 2024
  // for some AMCs regardless of when that AMC's own stock actually
  // started trading (e.g. SBI's price history only starts 2026-07-21),
  // so taking driverRanged[0] directly would report a "fitted from" date
  // that was never actually part of the fit.
  const priceRangedByDate = new Map(priceRanged.map((p) => [p.date, p.value]));
  const flagByDate = new Map(laggedEstimateFlag.map((p) => [p.date, p.value]));
  const chartPoints: RegressionChartPoint[] = [];
  const alignedDates: string[] = [];
  let estimatedSessionCount = 0;
  for (const point of driverRanged) {
    const close = priceRangedByDate.get(point.date);
    if (close === undefined) continue;
    alignedDates.push(point.date);
    chartPoints.push({ date: point.date, close, model: fit.slope * point.value + fit.intercept });
    if (flagByDate.get(point.date) === 1) estimatedSessionCount++;
  }

  const latestDriver = xs[xs.length - 1];
  const latestPrice = ys[ys.length - 1];
  const fairValueAtLatest = fit.slope * latestDriver + fit.intercept;

  // Right panel: unlagged, same-day ratio stats (no extra lag, no base
  // 1-session lag) over the same range window.
  const unlaggedDriverRanged = filterByCutoff(aumDated, cutoffDate);
  const { xs: ratioAumXs, ys: ratioPriceYs } = alignSeriesByDate(unlaggedDriverRanged, priceRanged);
  const ratioStats = priceToAumRatioStats(ratioAumXs, ratioPriceYs);
  const latestUnlaggedDriver = ratioAumXs.length > 0 ? ratioAumXs[ratioAumXs.length - 1] : null;
  const latestUnlaggedPrice = ratioPriceYs.length > 0 ? ratioPriceYs[ratioPriceYs.length - 1] : null;
  const currentRatio = latestUnlaggedDriver && latestUnlaggedDriver !== 0 && latestUnlaggedPrice !== null ? latestUnlaggedPrice / latestUnlaggedDriver : null;
  const currentSigma = ratioStats && currentRatio !== null && ratioStats.stdDev !== 0 ? (currentRatio - ratioStats.meanRatio) / ratioStats.stdDev : null;
  const priceAtMeanRatio = ratioStats && latestUnlaggedDriver !== null ? ratioStats.meanRatio * latestUnlaggedDriver : null;

  return {
    n: fit.n,
    slope: fit.slope,
    intercept: fit.intercept,
    r2: fit.r2,
    pearsonR: pearsonRResult,
    neweyWest: { lags: nw.lags, tStat: nw.tStat },
    durbinWatson: dw,
    holdout,
    driverMin,
    driverMax,
    driverVariationPct,
    fittedFrom: alignedDates[0] ?? "",
    fittedTo: alignedDates[alignedDates.length - 1] ?? "",
    latestPrice,
    latestDriver,
    fairValueAtLatest,
    estimatedSessionCount,
    ratioMean: ratioStats?.meanRatio ?? null,
    ratioStdDev: ratioStats?.stdDev ?? null,
    currentRatio,
    currentSigma,
    priceAtMeanRatio,
    chartPoints,
  };
}
