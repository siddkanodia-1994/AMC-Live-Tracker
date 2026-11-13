// AMC Analytics' Regression "Close ÷ Model" bands: each session's close over
// the levels best-fit line's value that day, the mean and (population) SD of
// that ratio over the fit window, and the price at each level -- today's
// model value × the ratio, so ±N SD sit an equal ₹ distance either side of
// the mean (the same way the Ratio sub-tab turns its ratio into a price).
// The line is fitted on these same sessions, so the mean sits near 1.00 and
// the Mean price near today's model value; the information is in the SDs.

import type { RegressionResult } from "./regression-engine";

export interface ModelRatioPoint {
  date: string;
  /** Close ÷ model that session. */
  ratio: number;
  close: number;
  model: number;
}

export interface ModelRatioLadder {
  points: ModelRatioPoint[];
  meanRatio: number;
  stdDev: number;
  /** Today's model value (the line at today's AUM), ₹ per share. */
  modelValue: number;
  /** The price given against the model now (CMP when passed, else the last close). */
  currentPrice: number;
  currentRatio: number;
  zScore: number | null;
  n: number;
  from: string;
  to: string;
}

export function computeModelRatioLadder(result: RegressionResult | null, currentPrice?: number | null): ModelRatioLadder | null {
  if (!result) return null;
  const points = result.chartPoints
    .filter((p) => p.model > 0 && Number.isFinite(p.close))
    .map((p) => ({ date: p.date, ratio: p.close / p.model, close: p.close, model: p.model }));
  if (points.length < 2 || !(result.fairValueAtLatest > 0)) return null;
  const meanRatio = points.reduce((s, p) => s + p.ratio, 0) / points.length;
  const stdDev = Math.sqrt(points.reduce((s, p) => s + (p.ratio - meanRatio) ** 2, 0) / points.length);
  const price = currentPrice ?? result.latestPrice;
  const currentRatio = price / result.fairValueAtLatest;
  return {
    points,
    meanRatio,
    stdDev,
    modelValue: result.fairValueAtLatest,
    currentPrice: price,
    currentRatio,
    zScore: stdDev > 0 ? (currentRatio - meanRatio) / stdDev : null,
    n: points.length,
    from: points[0].date,
    to: points[points.length - 1].date,
  };
}

/** The price when Close ÷ Model sits `sds` standard deviations from its mean. */
export function modelRatioPrice(ladder: ModelRatioLadder, sds: number): number {
  return ladder.modelValue * (ladder.meanRatio + sds * ladder.stdDev);
}
