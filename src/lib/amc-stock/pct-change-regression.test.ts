import { describe, expect, it } from "vitest";
import { computePctChangeRegression } from "./pct-change-regression";
import { computeCorrelationStats, computeMovingAverage, computeReturnsByDate } from "../aum/series-math";
import { computeRangeCutoffDate, filterByCutoff } from "../aum/date-range";
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

// The Stock Correlation table's Corr/R² with AUM-only avg on and Levels off.
function stockCorrelationStats(aumHistory: AumHistoryPoint[], prices: AmcStockPricePoint[], maDays: number, range: "3y" | "1y" | "6m") {
  const ma = computeMovingAverage(aumHistory.map((d) => d.liveAumCr), maDays);
  const aumFull = aumHistory.map((d, i) => ({ date: d.date, value: ma[i] }));
  const cut = computeRangeCutoffDate(aumFull, range);
  const aum = filterByCutoff(aumFull, cut).filter((d): d is { date: string; value: number } => d.value !== undefined);
  const price = filterByCutoff(prices.map((p) => ({ date: p.date, value: p.priceInr })), cut);
  return computeCorrelationStats(aum, price)!;
}

describe("computePctChangeRegression", () => {
  it("fits the same daily changes as Stock Correlation's Corr/R², so R² and n agree", () => {
    const { aumHistory, stockPriceSeries } = series();
    for (const range of ["3y", "1y", "6m"] as const) {
      const r = computePctChangeRegression(aumHistory, stockPriceSeries, { maWindow: 45, extraLagDays: 0, range })!;
      const sc = stockCorrelationStats(aumHistory, stockPriceSeries, 45, range);
      expect(r.n).toBe(sc.n);
      expect(r.r2).toBeCloseTo(sc.r2, 12);
      expect(r.pearsonR).toBeCloseTo(sc.r, 12);
    }
  });

  it("β and α are the OLS of the raw price's daily change on the AUM MA's daily change", () => {
    const { aumHistory, stockPriceSeries } = series();
    const r = computePctChangeRegression(aumHistory, stockPriceSeries, { maWindow: 20, extraLagDays: 0, range: "all" })!;
    const ma = computeMovingAverage(aumHistory.map((d) => d.liveAumCr), 20);
    const aumChg = computeReturnsByDate(aumHistory.map((d, i) => ({ date: d.date, value: ma[i]! })).filter((d) => d.value !== undefined));
    const priceChg = computeReturnsByDate(stockPriceSeries.map((p) => ({ date: p.date, value: p.priceInr })));
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [date, x] of aumChg) {
      const y = priceChg.get(date);
      if (y !== undefined) {
        xs.push(x);
        ys.push(y);
      }
    }
    const mx = xs.reduce((a, b) => a + b) / xs.length;
    const my = ys.reduce((a, b) => a + b) / ys.length;
    const beta = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    expect(r.beta).toBeCloseTo(beta, 10);
    expect(r.alpha).toBeCloseTo(my - beta * mx, 12);
    const last = r.points.at(-1)!;
    expect(last.model).toBeCloseTo(r.alpha + r.beta * last.aumChg, 12);
    expect(r.fittedTo).toBe(aumHistory.at(-1)!.date);
  });

  it("scores the holdout against a 0% 'price unchanged' day", () => {
    const { aumHistory, stockPriceSeries } = series();
    const r = computePctChangeRegression(aumHistory, stockPriceSeries, { maWindow: 45, extraLagDays: 0, range: "all" })!;
    const h = r.holdout!;
    expect(h.holdoutSessions).toBe(Math.max(Math.round(r.n * 0.2), 10));
    const tail = r.points.slice(-h.holdoutSessions);
    expect(h.naiveMaePp).toBeCloseTo((tail.reduce((s, p) => s + Math.abs(p.priceChg), 0) / tail.length) * 100, 9);
    expect(h.modelBeatsNaive).toBe(h.modelMaePp < h.naiveMaePp);
  });
});
