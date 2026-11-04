import { describe, expect, it } from "vitest";
import type { AumHistoryPoint } from "./history";
import { computeMonthlyGrowthRows } from "./summary-view";

// One point per calendar day from `from` to `to`, valued by `valueFor`.
function dailyPoints(from: string, to: string, valueFor: (date: string) => number): AumHistoryPoint[] {
  const points: AumHistoryPoint[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    points.push({ date, liveAumCr: valueFor(date), reportedAumCr: null, reportPeriod: "" });
  }
  return points;
}

// Flat 1000 + 10 per month since Jan 2025 -- so every full month's average
// is exactly that constant -- except Nov 2025, which climbs by 1 a day so a
// 1-4 Nov window averages differently from the whole month.
function monthlyValue(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const base = 1000 + 10 * ((y - 2025) * 12 + (m - 1));
  return y === 2025 && m === 11 ? base + d : base;
}

describe("computeMonthlyGrowthRows", () => {
  const history = dailyPoints("2025-07-01", "2026-11-04", monthlyValue);

  it("averages each month and compares the partial month against the same days last year", () => {
    const rows = computeMonthlyGrowthRows(history, "average", "2026-11-04");
    expect(rows.map((r) => r.label)).toEqual(["Nov 2026", "Oct 2026", "Sep 2026", "Nov 2025", "Oct 2025"]);
    expect(rows.map((r) => r.range)).toEqual([
      ["2026-11-01", "2026-11-04"],
      ["2026-10-01", "2026-10-31"],
      ["2026-09-01", "2026-09-30"],
      ["2025-11-01", "2025-11-04"],
      ["2025-10-01", "2025-10-31"],
    ]);
    expect(rows.map((r) => r.valCr)).toEqual([1220, 1210, 1200, 1102.5, 1090]);

    // MoM against the FULL prior month; YoY against the same days last year.
    expect(rows[0].momPct).toBeCloseTo(1220 / 1210 - 1, 12);
    expect(rows[0].yoyPct).toBeCloseTo(1220 / 1102.5 - 1, 12);
    expect(rows[1].momPct).toBeCloseTo(1210 / 1200 - 1, 12);
    expect(rows[1].yoyPct).toBeCloseTo(1210 / 1090 - 1, 12);
    // The third row's comparators (Aug 2026, Sep 2025) aren't rows themselves.
    expect(rows[2].momPct).toBeCloseTo(1200 / 1190 - 1, 12);
    expect(rows[2].yoyPct).toBeCloseTo(1200 / 1080 - 1, 12);

    // The last-year anchor rows carry no growth columns at all.
    expect(rows[3].momPct).toBeUndefined();
    expect(rows[3].yoyPct).toBeUndefined();
    expect(rows[4].momPct).toBeUndefined();
    expect(rows[4].yoyPct).toBeUndefined();
  });

  it("rolls over a year boundary", () => {
    const rows = computeMonthlyGrowthRows(dailyPoints("2025-07-01", "2027-01-15", monthlyValue), "average", "2027-01-15");
    expect(rows.map((r) => r.label)).toEqual(["Jan 2027", "Dec 2026", "Nov 2026", "Jan 2026", "Dec 2025"]);
    expect(rows[0].range).toEqual(["2027-01-01", "2027-01-15"]);
    expect(rows[3].range).toEqual(["2026-01-01", "2026-01-15"]);
  });

  it("clamps a 29 Feb as-of to 28 Feb a year earlier", () => {
    const rows = computeMonthlyGrowthRows(dailyPoints("2026-12-01", "2028-02-29", () => 100), "average", "2028-02-29");
    expect(rows[0].range).toEqual(["2028-02-01", "2028-02-29"]);
    expect(rows[3].range).toEqual(["2027-02-01", "2027-02-28"]);
  });

  it("returns null, not NaN, for a month with no sessions yet", () => {
    const rows = computeMonthlyGrowthRows(dailyPoints("2025-07-01", "2026-10-30", monthlyValue), "average", "2026-11-01");
    expect(rows[0].valCr).toBeNull();
    expect(rows[0].momPct).toBeNull();
    expect(rows[0].yoyPct).toBeNull();
  });

  it("adds the flow estimate only to rows whose window reaches the open gap", () => {
    // Report period 2026-08 -> the gap opens 1 Oct 2026.
    const rows = computeMonthlyGrowthRows(history, "average", "2026-11-04", { netFlowCr: 50, reportPeriod: "2026-08" });
    expect(rows.map((r) => r.valCr)).toEqual([1270, 1260, 1200, 1102.5, 1090]);
  });
});
