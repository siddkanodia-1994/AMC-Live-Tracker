import { describe, expect, it } from "vitest";
import { computeTargetPrices, mcapSalesBand, SCENARIO_KEYS, type TargetPriceInputs } from "./target-price";
import { computeRegressionResult } from "../amc-stock/regression-engine";
import { whatIfStartingAum } from "../amc-stock/aum-what-if";
import type { AumHistoryPoint, AmcStockPricePoint } from "../aum/history";

// ~400 weekdays of AUM rising with a wobble, and a price that tracks it
// with its own deterministic noise -- enough for a 3Y-range regression.
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

const HDFC_MANUAL: TargetPriceInputs["manual"] = {
  noOfSharesCr: 42.9,
  patFy28eCr: 4066.23,
  targetPeBear: 32,
  targetPeBase: 37,
  targetPeBull: 42,
  discountRateFy27Pct: 0.2,
  discountRateFy26Pct: 0.1,
  revenueFy28eCr: null,
  targetMcapSalesBear: null,
  targetMcapSalesBase: null,
  targetMcapSalesBull: null,
};

function inputs(overrides: Partial<TargetPriceInputs> = {}): TargetPriceInputs {
  return {
    ...series(),
    ratioRange: "3y",
    ratioHistoryDays: 45,
    ratioTodayDays: 45,
    bestFitRange: "3y",
    bestFitMaDays: 45,
    extraLagDays: 0,
    bestFitAumDays: 45,
    bestFitAumPct: 10,
    manual: HDFC_MANUAL,
    mcapSalesSeries: [
      { date: "2026-10-01", value: 26 },
      { date: "2026-10-02", value: 30 },
      { date: "2026-10-05", value: 28 },
    ],
    cmpInr: 2619.6,
    ...overrides,
  };
}

describe("computeTargetPrices", () => {
  it("PE: FY28E PAT × target PE ÷ shares, discounted two periods (Fortnightly's FY26 stage)", () => {
    const t = computeTargetPrices(inputs());
    // HDFC, 9 Nov 2026: 4066.23 × 37 ÷ 42.9 ÷ (1.2 × 1.1) ≈ 2,657
    expect(t.methods.pe.base).toBeCloseTo((4066.23 * 37) / 42.9 / (1.2 * 1.1), 6);
    expect(Math.round(t.methods.pe.base!)).toBe(2657);
    expect(t.methods.pe.bear).toBeCloseTo((4066.23 * 32) / 42.9 / 1.32, 6);
    expect(t.upside.pe.base).toBeCloseTo(t.methods.pe.base! / 2619.6 - 1, 12);
  });

  it("Ratio: mean ∓ 1 SD × today's N-day-avg AUM; Base equals the regression's price at mean ratio", () => {
    const inp = inputs();
    const t = computeTargetPrices(inp);
    const r = computeRegressionResult(inp.aumHistory, inp.stockPriceSeries, { maWindow: 45, extraLagDays: 0, range: "3y" })!;
    expect(t.methods.ratio.base).toBeCloseTo(r.priceAtMeanRatio!, 6);
    expect(t.methods.ratio.bear).toBeCloseTo((r.ratioMean! - r.ratioStdDev!) * t.ratioAumCr!, 6);
    expect(t.methods.ratio.bull).toBeCloseTo((r.ratioMean! + r.ratioStdDev!) * t.ratioAumCr!, 6);
    expect(t.ratioFit).toEqual({ sessions: r.n, mean: r.ratioMean, sd: r.ratioStdDev });
    // Live today's AUM keeps the 45D-avg mean and SD, times the live AUM.
    const live = computeTargetPrices(inputs({ ratioTodayDays: 0 }));
    expect(live.ratioAumCr).toBeCloseTo(inp.aumHistory.at(-1)!.liveAumCr, 6);
    expect(live.methods.ratio.base).toBeCloseTo(r.ratioMean! * inp.aumHistory.at(-1)!.liveAumCr, 6);
    expect(live.methods.ratio.base).not.toBeCloseTo(t.methods.ratio.base!, 2);
  });

  it("Ratio: its own period and history average drive the mean and SD; today's AUM stays as picked", () => {
    const inp = inputs({ ratioRange: "6m", ratioHistoryDays: 20, ratioTodayDays: 45 });
    const t = computeTargetPrices(inp);
    const r = computeRegressionResult(inp.aumHistory, inp.stockPriceSeries, { maWindow: 20, extraLagDays: 0, range: "6m" })!;
    const aum45 = whatIfStartingAum(inp.aumHistory.map((d) => d.liveAumCr), 45)!;
    expect(t.ratioAumCr).toBeCloseTo(aum45, 6);
    expect(t.methods.ratio.base).toBeCloseTo(r.ratioMean! * aum45, 6);
    expect(t.methods.ratio.bull).toBeCloseTo((r.ratioMean! + r.ratioStdDev!) * aum45, 6);
    expect(t.ratioFit?.sessions).toBe(r.n);
  });

  it("Best fit: its own period and moving average", () => {
    const inp = inputs({ bestFitRange: "1y", bestFitMaDays: 20, bestFitAumDays: 0 });
    const t = computeTargetPrices(inp);
    const line = computeRegressionResult(inp.aumHistory, inp.stockPriceSeries, { maWindow: 20, extraLagDays: 0, range: "1y" })!;
    const aum = inp.aumHistory.at(-1)!.liveAumCr;
    expect(t.methods.bestFit.base).toBeCloseTo(line.slope * aum + line.intercept, 6);
    expect(t.bestFitLine).toEqual({ sessions: line.n, r2: line.r2, slope: line.slope });
  });

  it("Best fit: the saved-MA line at the chosen starting AUM, and at that AUM −/+ x%", () => {
    const inp = inputs({ bestFitAumDays: 5, bestFitAumPct: 10 });
    const t = computeTargetPrices(inp);
    const line = computeRegressionResult(inp.aumHistory, inp.stockPriceSeries, { maWindow: 45, extraLagDays: 0, range: "3y" })!;
    const aum = whatIfStartingAum(inp.aumHistory.map((d) => d.liveAumCr), 5)!;
    expect(t.bestFitAumCr).toBeCloseTo(aum, 6);
    expect(t.methods.bestFit.base).toBeCloseTo(line.slope * aum + line.intercept, 6);
    expect(t.methods.bestFit.bear).toBeCloseTo(line.slope * aum * 0.9 + line.intercept, 6);
    expect(t.methods.bestFit.bull).toBeCloseTo(line.slope * aum * 1.1 + line.intercept, 6);
    // At 45D the Base is the table's own Model fair value.
    const at45 = computeTargetPrices(inputs());
    expect(at45.methods.bestFit.base).toBeCloseTo(line.fairValueAtLatest, 6);
  });

  it("Custom: Ratio and Best fit use their own typed AUM, unaffected by each other", () => {
    const t = computeTargetPrices(inputs({ ratioTodayDays: -1, ratioCustomAumCr: 500000, bestFitAumDays: -1, bestFitCustomAumCr: 450000 }));
    const base = computeTargetPrices(inputs());
    const r = computeRegressionResult(inputs().aumHistory, inputs().stockPriceSeries, { maWindow: 45, extraLagDays: 0, range: "3y" })!;
    expect(t.ratioAumCr).toBe(500000);
    expect(t.methods.ratio.base).toBeCloseTo(r.ratioMean! * 500000, 6);
    expect(t.bestFitAumCr).toBe(450000);
    expect(t.methods.bestFit.base).toBeCloseTo(r.slope * 450000 + r.intercept, 6);
    expect(t.methods.bestFit.bull).toBeCloseTo(r.slope * 450000 * 1.1 + r.intercept, 6);
    // The other two methods don't move.
    expect(t.methods.pe).toEqual(base.methods.pe);
    expect(t.methods.mcapSales).toEqual(base.methods.mcapSales);
  });

  it("Custom with nothing typed starts from the 45-day average, never from the live value", () => {
    const inp = inputs({ ratioTodayDays: -1, bestFitAumDays: -1, bestFitCustomAumCr: 0 });
    const t = computeTargetPrices(inp);
    const aum45 = whatIfStartingAum(inp.aumHistory.map((d) => d.liveAumCr), 45)!;
    expect(t.ratioAumCr).toBeCloseTo(aum45, 6);
    expect(t.bestFitAumCr).toBeCloseTo(aum45, 6);
  });

  it("Mcap / Sales: blank multiples use the chart's −1 SD / Mean / +1 SD; typed ones override", () => {
    const band = mcapSalesBand([
      { date: "2026-10-01", value: 26 },
      { date: "2026-10-02", value: 30 },
      { date: "2026-10-05", value: 28 },
    ])!;
    expect(band.mean).toBeCloseTo(28, 12);
    expect(band.sd).toBeCloseTo(2, 12); // sample SD
    const withRevenue = computeTargetPrices(inputs({ manual: { ...HDFC_MANUAL, revenueFy28eCr: 6000 } }));
    expect(withRevenue.mcapSalesMultiples).toEqual({ bear: 26, base: 28, bull: 30 });
    expect(withRevenue.mcapSalesFromBand).toEqual({ bear: true, base: true, bull: true });
    expect(withRevenue.methods.mcapSales.base).toBeCloseTo((6000 * 28) / 42.9 / 1.32, 6);

    const typed = computeTargetPrices(inputs({ manual: { ...HDFC_MANUAL, revenueFy28eCr: 6000, targetMcapSalesBull: 35 } }));
    expect(typed.mcapSalesMultiples.bull).toBe(35);
    expect(typed.mcapSalesFromBand.bull).toBe(false);
    expect(typed.methods.mcapSales.bull).toBeCloseTo((6000 * 35) / 42.9 / 1.32, 6);
  });

  it("drops a method with missing inputs from the Average and counts the rest", () => {
    const equal = { ratio: 25, bestFit: 25, pe: 25, mcapSales: 25 };
    const t = computeTargetPrices(inputs({ weights: equal })); // no FY28E revenue -> Mcap / Sales blank
    expect(t.methods.mcapSales).toEqual({ bear: null, base: null, bull: null });
    expect(t.averageCount).toEqual({ bear: 3, base: 3, bull: 3 });
    const m = t.methods;
    expect(t.average.base).toBeCloseTo((m.ratio.base! + m.bestFit.base! + m.pe.base!) / 3, 9);
    expect(t.upside.average.base).toBeCloseTo(t.average.base! / 2619.6 - 1, 12);

    const noFortnightly = computeTargetPrices(
      inputs({
        manual: { ...HDFC_MANUAL, noOfSharesCr: null, patFy28eCr: null, targetPeBear: null, targetPeBase: null, targetPeBull: null },
      })
    );
    expect(noFortnightly.methods.pe).toEqual({ bear: null, base: null, bull: null });
    expect(noFortnightly.averageCount.base).toBe(2);
  });

  it("weights the Average 35 / 10 / 50 / 5 by default", () => {
    const t = computeTargetPrices(inputs({ manual: { ...HDFC_MANUAL, revenueFy28eCr: 6000 } }));
    const m = t.methods;
    for (const k of SCENARIO_KEYS) {
      expect(t.average[k]).toBeCloseTo(0.35 * m.ratio[k]! + 0.1 * m.bestFit[k]! + 0.5 * m.pe[k]! + 0.05 * m.mcapSales[k]!, 9);
    }
    expect(t.averageShares).toEqual({ ratio: 0.35, bestFit: 0.1, pe: 0.5, mcapSales: 0.05 });
  });

  it("rescales the weights of the methods that count back to 100%", () => {
    // Mcap / Sales blank: 35 / 10 / 50 over 95.
    const t = computeTargetPrices(inputs());
    const m = t.methods;
    expect(t.average.base).toBeCloseTo((35 * m.ratio.base! + 10 * m.bestFit.base! + 50 * m.pe.base!) / 95, 9);
    expect(t.averageShares.mcapSales).toBeNull();
    expect(t.averageShares.pe).toBeCloseTo(50 / 95, 12);
    // A set that doesn't add up to 100, and a 0% method, scale the same way.
    const odd = computeTargetPrices(inputs({ weights: { ratio: 40, bestFit: 0, pe: 40, mcapSales: 30 } }));
    expect(odd.average.base).toBeCloseTo((odd.methods.ratio.base! + odd.methods.pe.base!) / 2, 9);
    expect(odd.averageCount.base).toBe(2);
    const none = computeTargetPrices(inputs({ weights: { ratio: 0, bestFit: 0, pe: 0, mcapSales: 0 } }));
    expect(none.average).toEqual({ bear: null, base: null, bull: null });
  });

  it("returns no upside without a current price", () => {
    const t = computeTargetPrices(inputs({ cmpInr: null }));
    expect(t.methods.ratio.base).not.toBeNull();
    expect(t.upside.ratio.base).toBeNull();
  });
});
