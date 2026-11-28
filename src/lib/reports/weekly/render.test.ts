import { describe, expect, it } from "vitest";
import type { AmcWeekly } from "./types";
import { escapeHtml, pct, sortDesc, targetYearGrowth } from "./render";

const amc = (short: string, qoq: number | null, pat: Record<number, number | null> = {}) => ({ short, aum: { qoq }, earnings: { pat } }) as unknown as AmcWeekly;

describe("sortDesc", () => {
  it("orders highest first, puts missing figures last, and keeps tab order on ties", () => {
    const rows = [amc("A", 0.01), amc("B", null), amc("C", 0.03), amc("D", 0.01), amc("E", -0.02)];
    expect(sortDesc(rows, (a) => a.aum.qoq).map((a) => a.short)).toEqual(["C", "A", "D", "E", "B"]);
  });
});

describe("targetYearGrowth", () => {
  it("is the target year over the year before, or null without both", () => {
    expect(targetYearGrowth(amc("X", 0, { 2028: 100, 2029: 120 }), 2029)).toBeCloseTo(0.2);
    expect(targetYearGrowth(amc("Y", 0, { 2028: null, 2029: 4356 }), 2029)).toBeNull();
  });
});

describe("formatting", () => {
  it("signs percentages and escapes commentary", () => {
    expect(pct(0.0712)).toBe("+7.1%");
    expect(pct(-0.024)).toBe("−2.4%");
    expect(pct(0.00001)).toBe("0.0%");
    expect(escapeHtml(`<img src=x onerror="a">`)).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;");
  });
});
