import { describe, expect, it } from "vitest";
import { computeFitCorrelation, fitStrength } from "./fit-stats";
import { computeRegressionResult } from "./regression-engine";
import { computePctChangeRegression } from "./pct-change-regression";
import { computeCorrelationStats, computeMovingAverage } from "../aum/series-math";
import { computeRangeCutoffDate, filterByCutoff } from "../aum/date-range";
import type { AumHistoryPoint, AmcStockPricePoint } from "../aum/history";

// ~400 weekdays of AUM rising with a wobble and a price tracking it with its
// own noise (same shape as pct-change-regression.test.ts).
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
const base = { maDays: 20, range: "1y" as const, extraLagDays: 0 };

describe("computeFitCorrelation", () => {
  it("Levels with AUM-only avg is the Regression section's levels model (same r, R², n)", () => {
    const corr = computeFitCorrelation(aumHistory, stockPriceSeries, { ...base, aumOnlyAveraging: true, levelsCorrelation: true })!;
    const reg = computeRegressionResult(aumHistory, stockPriceSeries, { maWindow: 20, extraLagDays: 0, range: "1y" })!;
    expect(corr.r).toBeCloseTo(reg.pearsonR!, 10);
    expect(corr.r2).toBeCloseTo(reg.r2, 10);
    expect(corr.n).toBe(reg.n);
  });

  it("daily % change with AUM-only avg is the daily % change model (same r, R², n)", () => {
    const corr = computeFitCorrelation(aumHistory, stockPriceSeries, { ...base, aumOnlyAveraging: true, levelsCorrelation: false })!;
    const reg = computePctChangeRegression(aumHistory, stockPriceSeries, { maWindow: 20, extraLagDays: 0, range: "1y" })!;
    expect(corr.r).toBeCloseTo(reg.pearsonR!, 10);
    expect(corr.r2).toBeCloseTo(reg.r2, 10);
    expect(corr.n).toBe(reg.n);
  });

  it("without AUM-only avg the price is averaged too, as the Stock Correlation table does", () => {
    const corr = computeFitCorrelation(aumHistory, stockPriceSeries, { ...base, aumOnlyAveraging: false, levelsCorrelation: false })!;
    const aumMa = computeMovingAverage(aumHistory.map((d) => d.liveAumCr), 20);
    const priceMa = computeMovingAverage(stockPriceSeries.map((p) => p.priceInr), 20);
    const aumFull = aumHistory.map((d, i) => ({ date: d.date, value: aumMa[i] }));
    const cut = computeRangeCutoffDate(aumFull, "1y");
    const keep = <T extends { value: number | undefined }>(xs: T[]) => xs.filter((x): x is T & { value: number } => x.value !== undefined);
    const expected = computeCorrelationStats(
      keep(filterByCutoff(aumFull, cut)),
      keep(filterByCutoff(stockPriceSeries.map((p, i) => ({ date: p.date, value: priceMa[i] })), cut))
    )!;
    expect(corr).toEqual(expected);
  });

  it("returns null with no data", () => {
    expect(computeFitCorrelation([], stockPriceSeries, { ...base, aumOnlyAveraging: true, levelsCorrelation: true })).toBeNull();
  });
});

describe("fitStrength", () => {
  it("bands |r| at 0.7 and 0.4", () => {
    expect(fitStrength(0.85)).toBe("strong");
    expect(fitStrength(-0.7)).toBe("strong");
    expect(fitStrength(0.5)).toBe("moderate");
    expect(fitStrength(0.4)).toBe("moderate");
    expect(fitStrength(0.09)).toBe("weak");
    expect(fitStrength(null)).toBeNull();
  });
});
