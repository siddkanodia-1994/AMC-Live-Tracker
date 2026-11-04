import { describe, expect, it } from "vitest";
import type { AumHistoryPoint, AmcStockPricePoint } from "../aum/history";
import { computeRegressionResult } from "./regression-engine";

// 60 consecutive calendar days of synthetic data (no gaps, so the
// continuous-run trim keeps all of it).
const dates = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
const aum: AumHistoryPoint[] = dates.map((date, i) => ({
  date,
  liveAumCr: 1000 + i * 10, // strictly increasing, so each MA value pins down its window
  reportedAumCr: 1000,
  reportPeriod: "2025-12",
}) as AumHistoryPoint);
const prices: AmcStockPricePoint[] = dates.map((date, i) => ({ date, priceInr: 500 + i * 3 + (i % 3) }));

const maEndingAt = (idx: number, window: number) => {
  let s = 0;
  for (let k = idx - window + 1; k <= idx; k++) s += aum[k].liveAumCr;
  return s / window;
};

describe("computeRegressionResult lag alignment", () => {
  it("Extra Lag 0 pairs each session's price with that same session's AUM MA (no hidden +1 floor)", () => {
    const r = computeRegressionResult(aum, prices, { maWindow: 5, extraLagDays: 0, range: "all" })!;
    const last = r.chartPoints[r.chartPoints.length - 1];
    expect(last.date).toBe(dates[59]);
    expect(last.driver).toBeCloseTo(maEndingAt(59, 5), 9);
    expect(r.latestDriver).toBeCloseTo(maEndingAt(59, 5), 9);
  });

  it("Extra Lag N lags the driver by exactly N sessions", () => {
    const r = computeRegressionResult(aum, prices, { maWindow: 5, extraLagDays: 45, range: "all" })!;
    const last = r.chartPoints[r.chartPoints.length - 1];
    expect(last.date).toBe(dates[59]);
    expect(last.driver).toBeCloseTo(maEndingAt(59 - 45, 5), 9);
  });

  it("model on each chart point is the fitted line at that point's driver", () => {
    const r = computeRegressionResult(aum, prices, { maWindow: 5, extraLagDays: 0, range: "all" })!;
    for (const p of r.chartPoints) expect(p.model).toBeCloseTo(r.slope * p.driver + r.intercept, 9);
  });
});
