import type { AumHistoryPoint, AmcStockPricePoint } from "../aum/history";
import { computeMovingAverage, computeReturnsByDate, lagSeriesForward, trimToLastContinuousRun, type DatedValue } from "../aum/series-math";
import { computeRangeCutoffDate, filterByCutoff } from "../aum/date-range";
import { durbinWatson, fitOls, neweyWestLagCount, neweyWestSlopeTStat } from "../aum/regression";
import type { RegressionConfig } from "./regression-engine";

// The AMC Analytics Regression section's "Levels (no % chg)" OFF model:
// today's % change in the raw share price regressed on today's % change in
// the AUM moving average,
//
//   %ΔPrice = α + β × %ΔAumMA
//
// built from exactly the daily changes the Stock Correlation table's
// Corr/R² use with AUM-only avg on (same MA, Extra Lag, range cutoff
// anchored on the AUM series, each series' own day-over-day change, then
// intersected by date), so its R² equals that table's R² for the same
// settings. Always the raw price, whatever the AUM-only avg toggle says
// (user's choice). A % change model has no price level, so fair value stays
// on the levels line (regression-engine.ts).

export interface PctChangePoint {
  date: string;
  /** Day-over-day change in the (lagged) AUM moving average, as a fraction. */
  aumChg: number;
  /** Day-over-day change in the raw share price, as a fraction. */
  priceChg: number;
  /** The fit's predicted price change for that day: α + β × aumChg. */
  model: number;
}

export interface PctChangeHoldout {
  holdoutSessions: number;
  /** Mean absolute error of the predicted daily change, in % points. */
  modelMaePp: number;
  /** Same for "price unchanged" (a 0% change every day). */
  naiveMaePp: number;
  modelBeatsNaive: boolean;
}

export interface PctChangeRegressionResult {
  n: number;
  beta: number;
  alpha: number;
  r2: number;
  pearsonR: number | null;
  neweyWest: { lags: number; tStat: number };
  durbinWatson: number | null;
  holdout: PctChangeHoldout | null;
  fittedFrom: string;
  fittedTo: string;
  points: PctChangePoint[];
}

// Same static 80/20 split as computeHoldoutBacktest, scored on the daily
// change itself: MAPE is meaningless when the actual change is ~0%.
function holdoutOnChanges(xs: number[], ys: number[]): PctChangeHoldout | null {
  const n = xs.length;
  if (n < 20) return null;
  const holdoutSize = Math.max(Math.round(n * 0.2), 10);
  const trainSize = n - holdoutSize;
  if (trainSize < 10) return null;
  const train = fitOls(xs.slice(0, trainSize), ys.slice(0, trainSize));
  if (!train) return null;
  let model = 0;
  let naive = 0;
  for (let i = trainSize; i < n; i++) {
    model += Math.abs(ys[i] - (train.intercept + train.slope * xs[i]));
    naive += Math.abs(ys[i]);
  }
  const modelMaePp = (model / holdoutSize) * 100;
  const naiveMaePp = (naive / holdoutSize) * 100;
  return { holdoutSessions: holdoutSize, modelMaePp, naiveMaePp, modelBeatsNaive: modelMaePp < naiveMaePp };
}

export function computePctChangeRegression(
  aumHistory: AumHistoryPoint[],
  priceSeries: AmcStockPricePoint[],
  config: RegressionConfig
): PctChangeRegressionResult | null {
  const data = trimToLastContinuousRun(aumHistory);
  if (data.length === 0 || priceSeries.length === 0) return null;
  const aumMa = computeMovingAverage(
    data.map((d) => d.liveAumCr),
    config.maWindow
  );
  const aumFull = lagSeriesForward(
    data.map((d, i) => ({ date: d.date, value: aumMa[i] })),
    config.extraLagDays
  );
  const priceFull = priceSeries.map((p) => ({ date: p.date, value: p.priceInr as number | undefined }));
  const cutoffDate = computeRangeCutoffDate(aumFull, config.range);
  const aumDated = filterByCutoff(aumFull, cutoffDate).filter((d): d is DatedValue => d.value !== undefined);
  const priceDated = filterByCutoff(priceFull, cutoffDate).filter((d): d is DatedValue => d.value !== undefined);

  const aumChanges = computeReturnsByDate(aumDated);
  const priceChanges = computeReturnsByDate(priceDated);
  const dates: string[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [date, aumChg] of aumChanges) {
    const priceChg = priceChanges.get(date);
    if (priceChg === undefined) continue;
    dates.push(date);
    xs.push(aumChg);
    ys.push(priceChg);
  }
  const fit = fitOls(xs, ys);
  if (!fit || fit.n < 2) return null;

  let pearsonR: number | null = null;
  {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let cov = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < xs.length; i++) {
      cov += (xs[i] - mx) * (ys[i] - my);
      vx += (xs[i] - mx) ** 2;
      vy += (ys[i] - my) ** 2;
    }
    if (vx !== 0 && vy !== 0) pearsonR = cov / Math.sqrt(vx * vy);
  }
  const nw = neweyWestSlopeTStat(xs, fit.residuals, fit.slope, neweyWestLagCount(fit.n));
  return {
    n: fit.n,
    beta: fit.slope,
    alpha: fit.intercept,
    r2: fit.r2,
    pearsonR,
    neweyWest: { lags: nw.lags, tStat: nw.tStat },
    durbinWatson: durbinWatson(fit.residuals),
    holdout: holdoutOnChanges(xs, ys),
    fittedFrom: dates[0],
    fittedTo: dates[dates.length - 1],
    points: dates.map((date, i) => ({ date, aumChg: xs[i], priceChg: ys[i], model: fit.intercept + fit.slope * xs[i] })),
  };
}
