import type { AumHistoryPoint } from "./history";

// Real NSE/BSE holiday clusters top out around 3-4 calendar days (a holiday
// adjacent to a weekend); anything larger is a genuine coverage break in the
// underlying data (e.g. a historical backfill that was only ever run for a
// couple of days and never completed), not a holiday.
const MAX_CONTINUOUS_GAP_DAYS = 5;

// Keeps only the LAST unbroken run of dates -- resets the start index every
// time a gap larger than the threshold is found, so any earlier orphaned
// data is dropped while ordinary holiday-sized gaps within the real
// continuous history are left alone. Purely a display filter; the
// underlying live_aum_daily_snapshot rows are untouched. Shared by the AUM
// Trend chart and the Stock Correlation summary tab so the same AMC always
// shows the same trimmed history (and thus the same correlation) in both
// places.
export function trimToLastContinuousRun(data: AumHistoryPoint[]): AumHistoryPoint[] {
  if (data.length === 0) return data;
  let startIdx = 0;
  for (let i = 1; i < data.length; i++) {
    const gapDays = (Date.parse(data[i].date) - Date.parse(data[i - 1].date)) / 86_400_000;
    if (gapDays > MAX_CONTINUOUS_GAP_DAYS) startIdx = i;
  }
  return data.slice(startIdx);
}

// Trailing moving average that requires a genuine full window -- a real
// N-day average can't exist until N real days have accumulated, so the
// first (windowDays - 1) points are `undefined` rather than a partial/
// expanding-window average (a true 7-day average starting on data from
// 1 Jan only first exists on 7 Jan; 5 Jan only has 5 days behind it).
// Every defined point still counts strictly BACKWARD from its own date
// through the preceding (windowDays - 1) entries -- a plain trailing sum,
// never forward-looking or centered. windowDays === 1 is still the
// identity transform (every index already satisfies i >= windowDays - 1),
// which is what "off" (the default everywhere this is used) relies on.
export function computeMovingAverage(values: number[], windowDays: number): (number | undefined)[] {
  const result: (number | undefined)[] = [];
  let windowSum = 0;
  for (let i = 0; i < values.length; i++) {
    windowSum += values[i];
    if (i >= windowDays) windowSum -= values[i - windowDays];
    result.push(i >= windowDays - 1 ? windowSum / windowDays : undefined);
  }
  return result;
}

export interface DatedValue {
  date: string;
  value: number;
}

// Index of the first defined entry in a computeMovingAverage result, or -1
// if every entry is undefined (the requested window is longer than the
// whole series) -- used to render a "showing from <date>" caption when a
// moving average trims off leading days, and to detect the "not enough
// history at all" case (decision: show nothing for that line/row rather
// than falling back to raw values).
export function firstDefinedIndex(values: (number | undefined)[]): number {
  return values.findIndex((v) => v !== undefined);
}

// Drops the undefined-prefix entries a moving average leaves before its
// first full window, pairing each remaining value with its date -- the
// shared "build a DatedValue[] from a possibly-partial moving-average
// result" step every consumer (chart correlation, regression, summary
// table) needs before feeding dates/values into anything else in this file.
export function toDatedValues(dates: string[], values: (number | undefined)[]): DatedValue[] {
  const result: DatedValue[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value !== undefined) result.push({ date: dates[i], value });
  }
  return result;
}

// Left-joins two DatedValue[] series by date, keeping only dates present in
// BOTH -- the general "align two possibly-gappy series" building block for
// both level-based regression (this file's linearRegression) and,
// separately, computeReturnsByDate's returns-based correlation below.
export function alignSeriesByDate(seriesA: DatedValue[], seriesB: DatedValue[]): { xs: number[]; ys: number[] } {
  const byDate = new Map(seriesB.map((p) => [p.date, p.value]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of seriesA) {
    const other = byDate.get(point.date);
    if (other !== undefined) {
      xs.push(point.value);
      ys.push(other);
    }
  }
  return { xs, ys };
}

// Day-over-day % change, keyed by the LATER date of each pair -- computed
// over the series' own consecutive entries (whatever gaps it has), so a
// return always reflects that series' actual trading-day-to-trading-day
// move rather than an interval borrowed from the other series once the two
// are intersected by date in computeCorrelationStats.
export function computeReturnsByDate(points: DatedValue[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value;
    if (prev !== 0) map.set(points[i].date, (points[i].value - prev) / prev);
  }
  return map;
}

export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX === 0 || varianceY === 0) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

export interface CorrelationStats {
  r: number;
  r2: number;
  n: number;
}

// Correlates day-over-day RETURNS (not raw ₹-crore/₹-share levels) of
// whatever's currently displayed for each series -- two series that both
// trend upward for months would otherwise show spuriously high
// level-correlation regardless of whether they actually move together day
// to day. R² = r² exactly, since this is a single-predictor (bivariate)
// case -- no separate regression needed. Returns null when there aren't at
// least two overlapping return-days (e.g. a newly-listed stock with almost
// no price history yet).
export function computeCorrelationStats(seriesA: DatedValue[], seriesB: DatedValue[]): CorrelationStats | null {
  const returnsA = computeReturnsByDate(seriesA);
  const returnsB = computeReturnsByDate(seriesB);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [date, valueA] of returnsA) {
    const valueB = returnsB.get(date);
    if (valueB !== undefined) {
      xs.push(valueA);
      ys.push(valueB);
    }
  }
  const r = pearsonCorrelation(xs, ys);
  if (r === null) return null;
  return { r, r2: r * r, n: xs.length };
}

export interface LinearRegression {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
}

// Simple least-squares fit of ys on xs (LEVELS, not returns) -- used only
// for the Stock Correlation tab's "regression fair value price", a
// distinct statistic from computeCorrelationStats' returns-based Corr/R²
// (that one matches the AUM Trend chart's headline number; this one exists
// solely to turn a Live AUM level into a predicted share-price level, which
// a returns-based fit can't do). Returns null below 2 points, same as
// computeCorrelationStats.
export function linearRegression(xs: number[], ys: number[]): LinearRegression | null {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r = sxy / Math.sqrt(sxx * syy);
  return { slope, intercept, r2: r * r, n };
}
