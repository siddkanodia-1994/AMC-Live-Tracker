import { describe, expect, it } from "vitest";
import { computeValuationBlock } from "./valuation-block";
import { estimateFor, fyLabel, isTargetFy, manualForTargetYear, snapshotFieldFor, targetYearOptions } from "./target-year";

// HDFC's stored inputs on 23 Nov 2026.
const hdfc = {
  noOfSharesCr: 42.9,
  patFy26aCr: 2858,
  patFy27eCr: 3356.4,
  patFy28eCr: 4066.23,
  targetPeBear: 34,
  targetPeBase: 38.5,
  targetPeBull: 43,
  discountRateFy27Pct: 0.2,
  discountRateFy26Pct: 0.1,
  revenueFy28eCr: 5682,
};

describe("target year", () => {
  it("labels and validates years", () => {
    expect(fyLabel(2029)).toBe("FY29");
    expect(fyLabel(2100)).toBe("FY00");
    expect(isTargetFy(2029)).toBe(true);
    expect(isTargetFy(2029.5)).toBe(false);
    expect(isTargetFy("2029")).toBe(false);
    expect(isTargetFy(2025)).toBe(false);
  });

  it("offers the next three years, keeping a saved year that fell out", () => {
    expect(targetYearOptions(2027, 2028)).toEqual([2028, 2029, 2030]);
    expect(targetYearOptions(2028, 2028)).toEqual([2028, 2029, 2030, 2031]);
    expect(targetYearOptions(2028, 2030)).toEqual([2029, 2030, 2031]);
  });

  it("keeps FY26–FY28 PAT and FY28 revenue in the snapshot, every other year in the table", () => {
    expect(snapshotFieldFor("pat", 2028)).toBe("patFy28eCr");
    expect(snapshotFieldFor("pat", 2026)).toBe("patFy26aCr");
    expect(snapshotFieldFor("revenue", 2028)).toBe("revenueFy28eCr");
    expect(snapshotFieldFor("revenue", 2027)).toBeNull();
    expect(snapshotFieldFor("pat", 2029)).toBeNull();
    const stored = { 2029: { patCr: 4926, revenueCr: null }, 2028: { patCr: 1, revenueCr: 1 } };
    expect(estimateFor(hdfc, stored, "pat", 2029)).toBe(4926);
    expect(estimateFor(hdfc, stored, "revenue", 2029)).toBeNull();
    // A stray table row for a snapshot year is never read.
    expect(estimateFor(hdfc, stored, "pat", 2028)).toBe(4066.23);
    expect(estimateFor(hdfc, undefined, "pat", 2030)).toBeNull();
  });

  it("is today's valuation exactly at FY28", () => {
    const m = manualForTargetYear(hdfc, { 2029: { patCr: 4926, revenueCr: 6884 } }, 2028);
    expect(m).toEqual(hdfc);
    const v = computeValuationBlock(m, 2682);
    expect(Math.round(v.fy26DiscountedPriceInr.base!)).toBe(2765);
  });

  it("builds FY29 on FY29E figures, discounted by the same two step rates", () => {
    const m = manualForTargetYear(hdfc, { 2029: { patCr: 4926, revenueCr: 6884 } }, 2029);
    expect(m.patFy28eCr).toBe(4926);
    expect(m.revenueFy28eCr).toBe(6884);
    expect(m.patFy26aCr).toBe(2858);
    const v = computeValuationBlock(m, 2682);
    expect(v.fy28TargetPriceInr.base).toBeCloseTo((4926 * 38.5) / 42.9, 6);
    expect(v.fy26DiscountedPriceInr.base).toBeCloseTo((4926 * 38.5) / 42.9 / (1.2 * 1.1), 6);
  });

  it("leaves a year with nothing typed blank, not zero", () => {
    const m = manualForTargetYear(hdfc, {}, 2030);
    expect(m.patFy28eCr).toBeNull();
    expect(computeValuationBlock(m, 2682).fy26DiscountedPriceInr.base).toBeNull();
  });
});
