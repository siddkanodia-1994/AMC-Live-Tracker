import { describe, expect, it } from "vitest";
import type { StockCorrelationDefaults } from "./correlation-defaults";
import type { AmcStockCorrelationEntry } from "./correlation-summary";
import { DEFAULT_WHAT_IF_AUM_DAYS } from "./aum-what-if";
import { currentPriceOf, liveFairValueAum, predictorStartAum, savedFitView, savedPredictorInput, savedRegressionConfig, whatIfDaysOf } from "./fit-section-inputs";

const ENTRY = {
  slug: "sbi-mutual-fund",
  aumHistory: [100, 110, 120, 130, 140].map((v, i) => ({ date: `2026-11-2${i}`, liveAumCr: v, reportedAumCr: null, reportPeriod: "" })),
  stockPriceSeries: [{ date: "2026-11-24", priceInr: 525.15 }],
} as unknown as AmcStockCorrelationEntry;

describe("savedFitView", () => {
  it("opens on the built-in view with nothing saved", () => {
    expect(savedFitView(undefined)).toEqual({ range: "3y", maDays: 1, aumOnlyAveraging: false, levelsCorrelation: false });
  });
  it("reads the fit* keys, not the shared Stock Correlation ones", () => {
    const d = { range: "1y", maDays: 45, fitRange: "2y", fitMaDays: 10, fitAumOnlyAveraging: true, fitLevelsCorrelation: true } as unknown as StockCorrelationDefaults;
    expect(savedFitView(d)).toEqual({ range: "2y", maDays: 10, aumOnlyAveraging: true, levelsCorrelation: true });
  });
});

describe("Predictor inputs", () => {
  const d = { range: "3y", maDays: 45, extraLagDays: 0, aumInputs: { "sbi-mutual-fund": 450000 } } as unknown as StockCorrelationDefaults;
  it("fits on the shared range / MA / lag", () => {
    expect(savedRegressionConfig(d)).toEqual({ maWindow: 45, extraLagDays: 0, range: "3y" });
  });
  it("defaults the what-if window and reads the typed AUM", () => {
    expect(whatIfDaysOf(d)).toBe(DEFAULT_WHAT_IF_AUM_DAYS);
    expect(savedPredictorInput(ENTRY, d)).toBe(450000);
    expect(predictorStartAum(ENTRY, 0)).toBe(140);
  });
  it("uses live AUM when there is one, else the latest stored day", () => {
    expect(liveFairValueAum(ENTRY, 150)).toBe(150);
    expect(liveFairValueAum(ENTRY, null)).toBe(140);
  });
});

describe("currentPriceOf", () => {
  it("prefers today's live price, then the last close", () => {
    expect(currentPriceOf(ENTRY, 530)).toBe(530);
    expect(currentPriceOf(ENTRY, undefined)).toBe(525.15);
    expect(currentPriceOf(undefined, null)).toBeNull();
  });
});
