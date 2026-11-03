import { describe, expect, it } from "vitest";
import { effectiveSharesForDate, isOnPreSplitBasis, toAsTradedCloses, type ShareAdjustment } from "./share-adjustments";

const bansal: ShareAdjustment = { multiplier: 5, firstDetectedOn: "2026-10-16", lastPriceBeforeInr: 315.6, lastPriceAfterInr: 61.65 };
const moldTek: ShareAdjustment = { multiplier: 2, firstDetectedOn: "2026-10-09", lastPriceBeforeInr: 652.1, lastPriceAfterInr: 326.35 };
const jswDulux: ShareAdjustment = { multiplier: 10, firstDetectedOn: "2026-10-22", lastPriceBeforeInr: 2994.8, lastPriceAfterInr: 302.2 };

describe("isOnPreSplitBasis (carry-forward of an earlier period's split)", () => {
  it("carries a split forward when the newer file is still pre-split (Bansal Wire, Sep-26)", () => {
    expect(isOnPreSplitBasis(323.45, bansal)).toBe(true);
  });
  it("does not when the newer file already reports post-split shares (Mold-Tek, Sep-26)", () => {
    expect(isOnPreSplitBasis(330.3, moldTek)).toBe(false);
  });
  it("rejects missing or non-positive prices", () => {
    expect(isOnPreSplitBasis(0, bansal)).toBe(false);
    expect(isOnPreSplitBasis(300, { ...bansal, lastPriceAfterInr: 0 })).toBe(false);
  });
});

describe("effectiveSharesForDate", () => {
  it("applies the multiplier only on/after the split date", () => {
    expect(effectiveSharesForDate(2_459_448, jswDulux, "2026-10-21")).toBe(2_459_448);
    expect(effectiveSharesForDate(2_459_448, jswDulux, "2026-10-22")).toBe(24_594_480);
    expect(effectiveSharesForDate(100, undefined, "2026-10-22")).toBe(100);
  });
});

describe("toAsTradedCloses", () => {
  it("re-multiplies DHAN's split-adjusted pre-split closes and is idempotent", () => {
    const adjusted = [{ date: "2026-10-12", close: 305.1 }, { date: "2026-10-23", close: 286.6 }];
    const asTraded = toAsTradedCloses(adjusted, [jswDulux]);
    expect(asTraded[0].close).toBeCloseTo(3051, 6);
    expect(asTraded[1].close).toBe(286.6); // post-split day untouched
    expect(toAsTradedCloses(asTraded, [jswDulux])).toEqual(asTraded); // already as-traded: unchanged
  });
});
