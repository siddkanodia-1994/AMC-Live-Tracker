import { describe, expect, it } from "vitest";
import { computeRatioLadder } from "./ratio-ladder";
import { computeRegressionResult } from "../amc-stock/regression-engine";
import { computeMovingAverage } from "../aum/series-math";
import type { AumHistoryPoint, AmcStockPricePoint } from "../aum/history";

// ~400 weekdays of AUM rising with a wobble and a price tracking it with
// its own noise (same shape as target-price.test.ts).
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

describe("computeRatioLadder", () => {
  it("with AUM-only avg (raw price) equals the regression engine's ratio stats", () => {
    const { aumHistory, stockPriceSeries } = series();
    for (const range of ["3y", "1y", "6m"] as const) {
      const l = computeRatioLadder(aumHistory, stockPriceSeries, { maDays: 45, range, aumOnlyAveraging: true })!;
      const r = computeRegressionResult(aumHistory, stockPriceSeries, { maWindow: 45, extraLagDays: 0, range })!;
      expect(l.meanRatio).toBeCloseTo(r.ratioMean!, 12);
      expect(l.stdDev).toBeCloseTo(r.ratioStdDev!, 12);
      expect(l.currentRatio).toBeCloseTo(r.currentRatio!, 12);
      expect(l.zScore).toBeCloseTo(r.currentSigma!, 9);
      expect(l.meanRatio * l.aumCr).toBeCloseTo(r.priceAtMeanRatio!, 6);
    }
  });

  it("without AUM-only avg divides the N-day-avg price by the N-day-avg AUM", () => {
    const { aumHistory, stockPriceSeries } = series();
    const l = computeRatioLadder(aumHistory, stockPriceSeries, { maDays: 20, range: "all", aumOnlyAveraging: false })!;
    const aumMa = computeMovingAverage(aumHistory.map((d) => d.liveAumCr), 20);
    const priceMa = computeMovingAverage(stockPriceSeries.map((p) => p.priceInr), 20);
    expect(l.n).toBe(400 - 19);
    expect(l.currentRatio).toBeCloseTo(priceMa.at(-1)! / aumMa.at(-1)!, 12);
    expect(l.aumCr).toBeCloseTo(aumMa.at(-1)!, 6);
    const raw = computeRatioLadder(aumHistory, stockPriceSeries, { maDays: 20, range: "all", aumOnlyAveraging: true })!;
    expect(raw.currentRatio).not.toBeCloseTo(l.currentRatio, 6);
  });
});
