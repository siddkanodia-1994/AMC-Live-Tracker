// Pure OLS regression + diagnostics, with no knowledge of AMCs, dates, or
// AUM/price semantics -- the counterpart to series-math.ts's correlation
// helpers, but for an actual fitted line (slope/intercept/residuals/true
// R²) rather than a bivariate Pearson r. Nothing here existed anywhere in
// this codebase before the Regression tab (confirmed via repo-wide
// search) -- OLS, Newey-West, Durbin-Watson, and holdout backtesting are
// all net new.

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface OlsResult {
  slope: number;
  intercept: number;
  fitted: number[];
  residuals: number[];
  // TRUE R² = 1 - SSres/SStot -- distinct from series-math.ts's r² (which
  // is just Pearson r squared, a shortcut only valid for a bivariate fit
  // with no separate residual computation). Both are shown on the
  // Regression tab since the reference page itself treats them as two
  // related but separate numbers ("R² 0.56, r 0.75").
  r2: number;
  n: number;
}

// Returns null if there are fewer than 2 points or the driver (xs) has
// zero variance -- a flat driver can't identify a slope.
export function fitOls(xs: number[], ys: number[]): OlsResult | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  const meanX = mean(xs);
  const meanY = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const fitted = xs.map((x) => slope * x + intercept);
  const residuals = ys.map((y, i) => y - fitted[i]);
  const ssRes = residuals.reduce((s, r) => s + r * r, 0);
  const ssTot = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { slope, intercept, fitted, residuals, r2, n };
}

// Newey & West's (1994) automatic plug-in bandwidth, L = floor(4*(n/100)^(2/9)),
// the standard textbook/software-default lag count (statsmodels cov_hac,
// Stata newey use the same rule) -- clamped to [1, floor(n/4)] so a small
// sample (e.g. SBI's ~65 sessions) never asks for more lags than a
// quarter of the data, which would make the HAC estimate itself unstable.
// For this app's typical sample sizes (roughly 65-950 sessions) this
// yields lag counts around 3-6 -- smaller than the reference page's own
// "26 lags for 407 sessions" figure, an app-specific convention this
// doesn't try to reproduce; the standard automatic rule is the
// defensible choice here.
export function neweyWestLagCount(n: number): number {
  const auto = Math.floor(4 * Math.pow(n / 100, 2 / 9));
  return Math.max(1, Math.min(auto, Math.floor(n / 4)));
}

export interface NeweyWestResult {
  lags: number;
  seSlope: number;
  tStat: number;
}

// HAC-robust (sandwich) standard error for the OLS slope, specialized to
// simple regression: the slope's score at each point is the demeaned-x
// weighted residual, and the long-run variance of that score sums the
// lag-0 term plus a Bartlett-kernel-weighted sum of its autocovariances
// up to `lags`. Robust to the residual autocorrelation Durbin-Watson
// below is built to detect -- exactly what lets the tile row report a
// slope as "significant" even when DW itself is failing.
export function neweyWestSlopeTStat(xs: number[], residuals: number[], slope: number, lags: number): NeweyWestResult {
  const n = xs.length;
  const meanX = mean(xs);
  const scores = xs.map((x, i) => (x - meanX) * residuals[i]);
  const sxx = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);

  let longRunVar = scores.reduce((s, u) => s + u * u, 0);
  for (let l = 1; l <= lags; l++) {
    const weight = 1 - l / (lags + 1);
    let gamma = 0;
    for (let i = l; i < n; i++) gamma += scores[i] * scores[i - l];
    longRunVar += 2 * weight * gamma;
  }

  const varSlope = sxx > 0 ? longRunVar / (sxx * sxx) : 0;
  const seSlope = Math.sqrt(Math.max(varSlope, 0));
  const tStat = seSlope > 0 ? slope / seSlope : 0;
  return { lags, seSlope, tStat };
}

// DW = sum((e[t]-e[t-1])^2) / sum(e[t]^2), over residuals in chronological
// order (callers must pass them date-ascending). ~2 = no autocorrelation;
// near 0 = strong positive autocorrelation (the fair-value gap persists
// for weeks instead of closing quickly); near 4 = strong negative/
// oscillating. Returns null below 2 residuals.
export function durbinWatson(residuals: number[]): number | null {
  if (residuals.length < 2) return null;
  let numerator = 0;
  for (let i = 1; i < residuals.length; i++) numerator += (residuals[i] - residuals[i - 1]) ** 2;
  const denominator = residuals.reduce((s, e) => s + e * e, 0);
  return denominator > 0 ? numerator / denominator : null;
}

export interface HoldoutResult {
  holdoutSessions: number;
  modelMapePct: number;
  naiveMapePct: number;
  modelBeatsNaive: boolean;
}

// A single STATIC 80/20 train/test split (last ~20% held out, matching
// the reference page's own ~81-of-407 ≈ 20% ratio) -- NOT a rolling/
// walk-forward backtest. Fits OLS on the first ~80% only, then compares
// that fit's mean absolute percentage error on the held-out 20% against
// a naive "yesterday's actual close" baseline over the same window. This
// fit is separate from and discarded after producing the two error
// numbers -- the headline equation/R²/NW-t/DW shown elsewhere always
// come from fitting on the full selected window.
// Returns null below 20 total sessions, since a holdout smaller than
// ~10 points either side is closer to noise than a real test -- callers
// should render this as a hard "insufficient sessions" warning.
export function computeHoldoutBacktest(xs: number[], ys: number[]): HoldoutResult | null {
  const n = xs.length;
  if (n < 20) return null;
  const holdoutSize = Math.max(Math.round(n * 0.2), 10);
  const trainSize = n - holdoutSize;
  if (trainSize < 10) return null;

  const trainFit = fitOls(xs.slice(0, trainSize), ys.slice(0, trainSize));
  if (!trainFit) return null;

  let modelAbsPctErr = 0;
  let naiveAbsPctErr = 0;
  let counted = 0;
  for (let i = trainSize; i < n; i++) {
    const actual = ys[i];
    if (actual === 0) continue;
    const predicted = trainFit.slope * xs[i] + trainFit.intercept;
    const naivePrediction = ys[i - 1];
    modelAbsPctErr += Math.abs(actual - predicted) / Math.abs(actual);
    naiveAbsPctErr += Math.abs(actual - naivePrediction) / Math.abs(actual);
    counted++;
  }
  if (counted === 0) return null;

  const modelMapePct = (modelAbsPctErr / counted) * 100;
  const naiveMapePct = (naiveAbsPctErr / counted) * 100;
  return { holdoutSessions: counted, modelMapePct, naiveMapePct, modelBeatsNaive: modelMapePct < naiveMapePct };
}
