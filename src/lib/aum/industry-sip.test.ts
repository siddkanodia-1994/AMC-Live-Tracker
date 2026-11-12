import { describe, expect, it } from "vitest";
import type { MonthlyFlowPoint } from "./industry-flows";
import {
  buildIndustrySipLedger,
  fiscalQuarterOf,
  monthShortLabel,
  quarterSip,
  shiftMonth,
  shiftQuarter,
  sipByMonth,
  thirdRowMonthBases,
  thirdRowQuarterBases,
} from "./industry-sip";

// AMFI industry SIP, April 2024 → September 2026 (₹ Cr, production on 2026-11-11).
const SIP = [
  20371, 20904, 21262, 23332, 23547, 24509, 25323, 25320, 26459, 26400, 25999, 25926, 26632, 26688, 27269, 28464, 28265, 29361, 29529,
  29445, 31002, 31002, 29845, 32087, 31115, 30954, 31781, 31961, 32297, 32490,
];
const POINTS: MonthlyFlowPoint[] = SIP.map((v, i) => {
  const key = shiftMonth("2024-04", i);
  return { monthEndDate: `${key}-28`, sipContributionsCr: v, equityNetFlowsCr: 0, equityBulkFlowsCr: 0 };
});
const BY_MONTH = sipByMonth(POINTS);

describe("calendar helpers", () => {
  it("maps months to Indian fiscal quarters", () => {
    expect(fiscalQuarterOf("2026-04")).toEqual({ fy: 2027, q: 1 });
    expect(fiscalQuarterOf("2026-09")).toEqual({ fy: 2027, q: 2 });
    expect(fiscalQuarterOf("2025-12")).toEqual({ fy: 2026, q: 3 });
    expect(fiscalQuarterOf("2026-03")).toEqual({ fy: 2026, q: 4 });
  });

  it("shifts months and quarters across year ends", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(shiftMonth("2026-07", -12)).toBe("2025-07");
    expect(shiftQuarter({ fy: 2027, q: 1 }, -1)).toEqual({ fy: 2026, q: 4 });
    expect(shiftQuarter({ fy: 2026, q: 4 }, 1)).toEqual({ fy: 2027, q: 1 });
    expect(monthShortLabel("2026-09")).toBe("Sep 26");
  });

  it("sums a fiscal quarter's months", () => {
    expect(quarterSip(BY_MONTH, { fy: 2027, q: 2 })).toBe(96748);
    expect(quarterSip(BY_MONTH, { fy: 2026, q: 4 })).toBe(92934);
    expect(quarterSip(BY_MONTH, { fy: 2024, q: 4 })).toBeNull();
  });
});

describe("third-row bases", () => {
  it("anchor Q2FY27: Q4FY26 compares with Q3FY26 and Q4FY25", () => {
    expect(thirdRowQuarterBases(BY_MONTH, { fy: 2027, q: 2 })).toEqual({ prev: 89976, yoy: 78325 });
  });

  it("anchor September 2026: July 2026 compares with June 2026 and July 2025", () => {
    expect(thirdRowMonthBases(BY_MONTH, 2026, 9)).toEqual({ prev: 31781, yoy: 28464 });
  });

  it("gives null bases when AMFI has no data that far back", () => {
    expect(thirdRowQuarterBases(BY_MONTH, { fy: 2025, q: 3 })).toEqual({ prev: null, yoy: null });
  });
});

describe("buildIndustrySipLedger", () => {
  const ledger = buildIndustrySipLedger(POINTS, 12)!;

  it("financial year: to date vs same months last year, then full years", () => {
    expect(ledger.latestMonth).toBe("2026-09");
    expect(ledger.financialYear.map((r) => [r.label, r.value])).toEqual([
      ["FY27 YTD (Apr–Sep)", 190598],
      ["FY26 same period", 166679],
      ["FY26", 349589],
      ["FY25", 289352],
    ]);
    expect(ledger.financialYear[0].yoy).toBeCloseTo(190598 / 166679 - 1, 12);
    expect(ledger.financialYear[1].muted).toBe(true);
    expect(ledger.financialYear[2].yoy).toBeCloseTo(349589 / 289352 - 1, 12);
    // FY24 isn't in the data, so FY25 has no YoY.
    expect(ledger.financialYear[3].yoy).toBeNull();
  });

  it("quarters: latest first with QoQ and YoY, stopping where data ends", () => {
    expect(ledger.quarter.map((r) => r.label)).toEqual(["Q2FY27", "Q1FY27", "Q4FY26", "Q3FY26", "Q2FY26", "Q1FY26"]);
    expect(ledger.quarter[0].step).toBeCloseTo(96748 / 93850 - 1, 12);
    expect(ledger.quarter[0].yoy).toBeCloseTo(96748 / 86090 - 1, 12);
    expect(ledger.quarter[2].step).toBeCloseTo(92934 / 89976 - 1, 12);
  });

  it("months: as many as asked for, MoM and YoY", () => {
    expect(ledger.month).toHaveLength(12);
    expect(ledger.month[0]).toMatchObject({ label: "September 2026", value: 32490 });
    expect(ledger.month[0].step).toBeCloseTo(32490 / 32297 - 1, 12);
    expect(ledger.month[0].yoy).toBeCloseTo(32490 / 29361 - 1, 12);
    expect(buildIndustrySipLedger(POINTS, 1000)!.month).toHaveLength(SIP.length);
    expect(buildIndustrySipLedger(POINTS, 1000)!.month.at(-1)).toMatchObject({ label: "April 2024", step: null, yoy: null });
  });

  it("returns null with no data", () => {
    expect(buildIndustrySipLedger([], 12)).toBeNull();
  });
});
