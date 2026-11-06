import { describe, expect, it } from "vitest";
import { computeAumWhatIf, isWhatIfAumDays, parseAumInput, whatIfStartingAum, type RegressionLine } from "./aum-what-if";
import { sanitizeAumInputs } from "./correlation-defaults";

// HDFC's production fit on 2026-11-06 (45D MA, 3Y, no extra lag).
const HDFC: RegressionLine = { slope: 0.004533998067382256, intercept: 755.69, driverMin: 191236, driverMax: 449528 };

describe("computeAumWhatIf", () => {
  it("reproduces Model fair value at the default 45D avg AUM", () => {
    const r = computeAumWhatIf(HDFC, 438659.11, 2649.8);
    expect(r.targetPrice).toBeCloseTo(2744.57, 1);
    expect(r.upsidePct).toBeCloseTo(0.0358, 4);
    expect(r.outOfRange).toBe(false);
  });

  it("prices a typed AUM and flags it outside the fitted range", () => {
    const r = computeAumWhatIf(HDFC, 480000, 2649.8);
    expect(r.targetPrice).toBeCloseTo(2932.01, 1);
    expect(r.upsidePct).toBeCloseTo(0.1065, 4);
    expect(r.outOfRange).toBe(true);
  });

  it("handles a negative slope (ICICI) and a missing price", () => {
    const icici: RegressionLine = { slope: -0.0014130763411002363, intercept: 3635.21, driverMin: 387819, driverMax: 425393 };
    expect(computeAumWhatIf(icici, 400000, null).targetPrice).toBeLessThan(computeAumWhatIf(icici, 390000, null).targetPrice);
    expect(computeAumWhatIf(icici, 400000, null).upsidePct).toBeNull();
    expect(computeAumWhatIf(icici, 400000, 0).upsidePct).toBeNull();
  });
});

describe("parseAumInput", () => {
  it("accepts Indian commas, ₹ and a trailing cr", () => {
    expect(parseAumInput("4,80,000")).toBe(480000);
    expect(parseAumInput("480000")).toBe(480000);
    expect(parseAumInput(" 4,80,000 cr ")).toBe(480000);
    expect(parseAumInput("₹ 480000.5")).toBe(480000.5);
  });

  it("rejects blank, zero, negative and non-numeric input", () => {
    for (const bad of ["", "  ", "0", "-5", "abc", "4.8.0", "1e5", "43864800059.1", "100000000"]) expect(parseAumInput(bad)).toBeNull();
  });
});

describe("sanitizeAumInputs", () => {
  it("keeps valid listed-AMC entries and drops the rest", () => {
    expect(sanitizeAumInputs({ "hdfc-mutual-fund": 480000, "not-an-amc": 5, "uti-mutual-fund": -1, "sbi-mutual-fund": 1e9 })).toEqual({
      "hdfc-mutual-fund": 480000,
    });
  });

  it("treats a missing field (older saved defaults) as empty, and rejects non-objects", () => {
    expect(sanitizeAumInputs(undefined)).toEqual({});
    expect(sanitizeAumInputs(null)).toEqual({});
    expect(sanitizeAumInputs([1, 2])).toBeNull();
    expect(sanitizeAumInputs("x")).toBeNull();
  });
});

describe("whatIfStartingAum", () => {
  const daily = [100, 110, 120, 130, 140, 150]; // oldest -> today

  it("0 is today's live value; N averages the last N days including today", () => {
    expect(whatIfStartingAum(daily, 0)).toBe(150);
    expect(whatIfStartingAum(daily, 5)).toBe(130); // 110..150
    expect(whatIfStartingAum(daily, 6)).toBe(125);
  });

  it("falls back to today's value when history is shorter than the window, and null when empty", () => {
    expect(whatIfStartingAum([90, 95], 5)).toBe(95);
    expect(whatIfStartingAum([], 5)).toBeNull();
  });

  it("only accepts the dropdown's windows", () => {
    for (const ok of [0, 5, 10, 15, 20]) expect(isWhatIfAumDays(ok)).toBe(true);
    for (const bad of [1, 45, -5, "5", null]) expect(isWhatIfAumDays(bad)).toBe(false);
  });
});
