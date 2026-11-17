import { describe, expect, it } from "vitest";
import { anchorMonths, computeAnchoredDailyAum, type IndexLevel } from "./industry-backfill";

// Mar 31 is a holiday (no row), so March's anchor falls on Mar 30.
const levels: IndexLevel[] = [
  { date: "2025-03-28", level: 100 },
  { date: "2025-03-30", level: 100 },
  { date: "2025-04-01", level: 101 },
  { date: "2025-04-02", level: 99 },
  { date: "2025-04-30", level: 102 },
  { date: "2025-05-02", level: 103 },
  { date: "2025-05-30", level: 104 },
];

describe("anchorMonths", () => {
  it("puts each month on its last trading day, skipping holidays", () => {
    const a = anchorMonths(
      [
        { reportMonth: "2025-04", exitAumCr: 1050 },
        { reportMonth: "2025-03", exitAumCr: 1000 },
      ],
      levels
    );
    expect(a.map((x) => [x.reportMonth, x.monthEndDate])).toEqual([
      ["2025-03", "2025-03-30"],
      ["2025-04", "2025-04-30"],
    ]);
  });

  it("refuses a month with no trading day", () => {
    expect(() => anchorMonths([{ reportMonth: "2025-06", exitAumCr: 1 }], levels)).toThrow(/2025-06/);
  });
});

describe("computeAnchoredDailyAum", () => {
  const anchors = anchorMonths(
    [
      { reportMonth: "2025-03", exitAumCr: 1000 },
      { reportMonth: "2025-04", exitAumCr: 1050 },
      { reportMonth: "2025-05", exitAumCr: 1040 },
    ],
    levels
  );
  const { rows, segments } = computeAnchoredDailyAum(anchors, levels);

  it("follows the index, then phases the month's gap in by trading day (the worked example)", () => {
    const april = rows.filter((r) => r.anchorMonthEndDate === "2025-04-30");
    expect(april.map((r) => r.rawCompoundedAumCr)).toEqual([1010, 990, 1020]);
    expect(april.map((r) => Math.round(r.estimatedAumCr * 100) / 100)).toEqual([1019.9, 1009.41, 1050]);
  });

  it("lands every month-end exactly on its anchor and starts the next month from it", () => {
    for (const a of anchors.slice(1)) expect(rows.find((r) => r.date === a.monthEndDate)!.estimatedAumCr).toBeCloseTo(a.exitAumCr, 9);
    expect(rows.find((r) => r.date === "2025-05-02")!.rawCompoundedAumCr).toBeCloseTo(1050 * (103 / 102), 9);
  });

  it("writes each trading day once, from the day after the first anchor", () => {
    expect(rows.map((r) => r.date)).toEqual(["2025-04-01", "2025-04-02", "2025-04-30", "2025-05-02", "2025-05-30"]);
  });

  it("summarises each month's index move, AUM move and leftover gap", () => {
    expect(segments[0]).toMatchObject({ reportMonth: "2025-04", tradingDays: 3 });
    expect(segments[0].indexReturn).toBeCloseTo(0.02, 12);
    expect(segments[0].aumReturn).toBeCloseTo(0.05, 12);
    expect(segments[0].gapPct).toBeCloseTo(1050 / 1020 - 1, 12);
  });

  it("refuses a month whose index rows are missing", () => {
    const gappy = levels.filter((l) => l.date !== "2025-04-30");
    expect(() => computeAnchoredDailyAum(anchors, gappy)).toThrow(/2025-03 -> 2025-04/);
  });
});
