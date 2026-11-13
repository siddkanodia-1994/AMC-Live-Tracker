import { describe, expect, it } from "vitest";
import { computeModelRatioLadder, modelRatioPrice } from "./model-ratio";
import { computeRegressionResult, type RegressionResult } from "./regression-engine";
import type { AumHistoryPoint, AmcStockPricePoint } from "../aum/history";

// ~400 weekdays of AUM rising with a wobble and a price tracking it with its
// own noise (same shape as fit-stats.test.ts).
function series(): { aumHistory: AumHistoryPoint[]; stockPriceSeries: AmcStockPricePoint[] } {
  const aumHistory: AumHistoryPoint[] = [];
  const stockPriceSeries: AmcStockPricePoint[] = [];
  const d = new Date("2025-03-03T00:00:00Z");
  let i = 0;
  while (aumHistory.length < 400) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const date = d.toISOString().slice(0, 10);
      const aum = 300000 + i * 300 + 4000 * Math.sin(i / 9);
      aumHistory.push({ date, liveAumCr: aum, reportedAumCr: aum, reportPeriod: "2026-09" });
      stockPriceSeries.push({ date, priceInr: 0.005 * aum + 400 + 25 * Math.sin(i / 4) });
      i++;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { aumHistory, stockPriceSeries };
}

const { aumHistory, stockPriceSeries } = series();
const result = computeRegressionResult(aumHistory, stockPriceSeries, { maWindow: 10, extraLagDays: 0, range: "1y" })!;

describe("computeModelRatioLadder", () => {
  it("is each session's close ÷ model, with the population mean and SD over the fit window", () => {
    const ladder = computeModelRatioLadder(result)!;
    const ratios = result.chartPoints.map((p) => p.close / p.model);
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const sd = Math.sqrt(ratios.reduce((s, r) => s + (r - mean) ** 2, 0) / ratios.length);
    expect(ladder.points.map((p) => p.ratio)).toEqual(ratios);
    expect(ladder.meanRatio).toBeCloseTo(mean, 12);
    expect(ladder.stdDev).toBeCloseTo(sd, 12);
    expect(ladder.n).toBe(result.n);
    expect(ladder.from).toBe(result.fittedFrom);
    expect(ladder.to).toBe(result.fittedTo);
  });

  it("sits near 1.00 on average, since the line is fitted on the same sessions", () => {
    expect(computeModelRatioLadder(result)!.meanRatio).toBeCloseTo(1, 2);
  });

  it("prices each level at today's model value × the ratio, an equal ₹ step either side of the mean", () => {
    const ladder = computeModelRatioLadder(result)!;
    const mean = modelRatioPrice(ladder, 0);
    expect(mean).toBeCloseTo(result.fairValueAtLatest * ladder.meanRatio, 9);
    expect(modelRatioPrice(ladder, 1) - mean).toBeCloseTo(mean - modelRatioPrice(ladder, -1), 9);
    expect(modelRatioPrice(ladder, 2) - mean).toBeCloseTo(2 * (modelRatioPrice(ladder, 1) - mean), 9);
  });

  it("measures today against the CMP when given one, else the last close", () => {
    const fromClose = computeModelRatioLadder(result)!;
    expect(fromClose.currentRatio).toBeCloseTo(result.latestPrice / result.fairValueAtLatest, 12);
    const live = computeModelRatioLadder(result, 1000)!;
    expect(live.currentPrice).toBe(1000);
    expect(live.currentRatio).toBeCloseTo(1000 / result.fairValueAtLatest, 12);
    expect(live.zScore).toBeCloseTo((live.currentRatio - live.meanRatio) / live.stdDev, 12);
  });

  it("returns null without a fit", () => {
    expect(computeModelRatioLadder(null)).toBeNull();
    expect(computeModelRatioLadder({ ...result, chartPoints: result.chartPoints.slice(0, 1) } as RegressionResult)).toBeNull();
  });
});
