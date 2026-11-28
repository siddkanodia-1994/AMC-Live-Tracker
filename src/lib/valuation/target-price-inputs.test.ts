import { describe, expect, it } from "vitest";
import type { StockCorrelationDefaults } from "../amc-stock/correlation-defaults";
import type { AmcStockCorrelationEntry } from "../amc-stock/correlation-summary";
import { buildTargetPriceInputs, resolveValuationSettings } from "./target-price-inputs";
import { DEFAULT_BEST_FIT_AUM_DAYS, DEFAULT_BEST_FIT_AUM_PCT, DEFAULT_VALUATION_RATIO_DAYS, DEFAULT_VALUATION_WEIGHTS } from "./valuation-settings";

const SAVED = {
  valuationRatioRange: "1y",
  valuationRatioHistoryDays: 10,
  valuationRatioDays: 0,
  bestFitRange: "2y",
  bestFitMaDays: 20,
  bestFitAumDays: 5,
  bestFitAumPct: 15,
  valuationRatioCustomAum: { "hdfc-mutual-fund": 500000 },
  bestFitCustomAum: {},
  valuationWeights: { ratio: 30, bestFit: 15, pe: 50, mcapSales: 5 },
  extraLagDays: 0,
} as unknown as StockCorrelationDefaults;

const ENTRY = {
  slug: "hdfc-mutual-fund",
  aumHistory: [{ date: "2026-11-26", liveAumCr: 100, reportedAumCr: null, reportPeriod: "" }],
  stockPriceSeries: [
    { date: "2026-11-26", priceInr: 100 },
    { date: "2026-11-27", priceInr: 110 },
  ],
} as unknown as AmcStockCorrelationEntry;

describe("resolveValuationSettings", () => {
  it("falls back to the built-in defaults with nothing saved", () => {
    const s = resolveValuationSettings(undefined);
    expect(s).toEqual({
      ratioRange: "3y",
      ratioHistoryDays: DEFAULT_VALUATION_RATIO_DAYS,
      ratioTodayDays: DEFAULT_VALUATION_RATIO_DAYS,
      bestFitRange: "3y",
      bestFitMaDays: DEFAULT_VALUATION_RATIO_DAYS,
      bestFitAumDays: DEFAULT_BEST_FIT_AUM_DAYS,
      bestFitAumPct: DEFAULT_BEST_FIT_AUM_PCT,
      ratioCustomAum: {},
      bestFitCustomAum: {},
      weights: DEFAULT_VALUATION_WEIGHTS,
    });
  });

  it("uses the saved settings, and unsaved picks over them", () => {
    const s = resolveValuationSettings(SAVED, { ratioTodayDays: 45, bestFitCustomAum: { "uti-mutual-fund": 90000 } });
    expect(s.ratioRange).toBe("1y");
    expect(s.ratioHistoryDays).toBe(10);
    expect(s.ratioTodayDays).toBe(45);
    expect(s.bestFitMaDays).toBe(20);
    expect(s.ratioCustomAum).toEqual({ "hdfc-mutual-fund": 500000 });
    expect(s.bestFitCustomAum).toEqual({ "uti-mutual-fund": 90000 });
    expect(s.weights).toEqual({ ratio: 30, bestFit: 15, pe: 50, mcapSales: 5 });
  });
});

describe("buildTargetPriceInputs", () => {
  it("passes the settings through and keeps only Mcap/Sales points", () => {
    const settings = resolveValuationSettings(SAVED);
    const manual = { noOfSharesCr: 1 } as never;
    const inputs = buildTargetPriceInputs({
      entry: ENTRY,
      defaults: SAVED,
      settings,
      manual,
      valuationPoints: [
        { date: "2026-11-25", pe: 30, mcapToSales: null },
        { date: "2026-11-26", pe: 31, mcapToSales: 20 },
      ],
      cmpInr: 110,
    });
    expect(inputs.ratioCustomAumCr).toBe(500000);
    expect(inputs.bestFitCustomAumCr).toBeNull();
    expect(inputs.ratioRange).toBe("1y");
    expect(inputs.bestFitAumPct).toBe(15);
    expect(inputs.manual).toBe(manual);
    expect(inputs.mcapSalesSeries).toEqual([{ date: "2026-11-26", value: 20 }]);
    expect(inputs.cmpInr).toBe(110);
    expect(inputs.weights).toEqual(SAVED.valuationWeights);
  });
});
