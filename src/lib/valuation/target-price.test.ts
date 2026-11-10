import { describe, expect, it } from "vitest";
import { computeTargetPrices, mcapSalesBand, type TargetPriceInputs } from "./target-price";
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
    range: "3y",
    maDays: 45,
    extraLagDays: 0,
    ratioDays: 45,
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
    // A different N changes both the history and today's AUM.
    const live = computeTargetPrices(inputs({ ratioDays: 0 }));
    expect(live.ratioAumCr).toBeCloseTo(inp.aumHistory.at(-1)!.liveAumCr, 6);
    expect(live.methods.ratio.base).not.toBeCloseTo(t.methods.ratio.base!, 2);
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
    const t = computeTargetPrices(inputs()); // no FY28E revenue -> Mcap / Sales blank
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

  it("returns no upside without a current price", () => {
    const t = computeTargetPrices(inputs({ cmpInr: null }));
    expect(t.methods.ratio.base).not.toBeNull();
    expect(t.upside.ratio.base).toBeNull();
  });
});
