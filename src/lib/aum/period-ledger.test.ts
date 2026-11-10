import { describe, expect, it } from "vitest";
import {
  buildPeriodLedger,
  formatLedgerInr,
  formatLedgerPct,
  ledgerCalendarOf,
  ledgerChange,
  type LedgerPoint,
} from "./period-ledger";
import { toLedgerPoints } from "./period-ledger-rows";

// Weekdays from `from` to `to` inclusive, skipping `holidays`, valued by `f`.
function weekdays(from: string, to: string, f: (iso: string, i: number) => number, holidays: string[] = []): LedgerPoint[] {
  const out: LedgerPoint[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  let i = 0;
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays.includes(iso)) out.push({ date: iso, value: f(iso, i++) });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("ledgerCalendarOf", () => {
  it("labels the Indian FY, quarter and month by the year the FY ends in", () => {
    expect(ledgerCalendarOf("2026-11-05")).toMatchObject({
      fyLabel: "FY 2027",
      qLabel: "Q3 FY 2027",
      mLabel: "FY 2027 November",
      dow: "Thursday",
    });
    expect(ledgerCalendarOf("2026-03-31")).toMatchObject({ fyLabel: "FY 2026", qLabel: "Q4 FY 2026" });
    expect(ledgerCalendarOf("2026-04-01")).toMatchObject({ fyLabel: "FY 2027", qLabel: "Q1 FY 2027" });
  });
});

describe("buildPeriodLedger", () => {
  it("averages each period over its observed days, not a total", () => {
    const pts = [
      { date: "2026-10-30", value: 100 },
      { date: "2026-11-02", value: 200 },
      { date: "2026-11-03", value: 400 },
    ];
    const m = buildPeriodLedger(pts);
    expect(m.period("m", "FY 2027 November")).toEqual({ value: 300, days: 2 });
    expect(m.period("m", "FY 2027 October")).toEqual({ value: 100, days: 1 });
    expect(m.period("q", "Q3 FY 2027").value).toBeCloseTo(700 / 3, 9);
    expect(m.period("fy", "FY 2026")).toEqual({ value: null, days: 0 });
  });

  it("sorts periods by time, never by label text", () => {
    const m = buildPeriodLedger(weekdays("2025-01-01", "2026-11-06", () => 1));
    expect(m.quarters.slice(-3)).toEqual(["Q1 FY 2027", "Q2 FY 2027", "Q3 FY 2027"]);
    expect(m.months.slice(-2)).toEqual(["FY 2027 October", "FY 2027 November"]);
    expect(m.fys).toEqual(["FY 2025", "FY 2026", "FY 2027"]);
  });

  it("counts rolling windows in observed days and leaves Prev 5 empty under 10 days", () => {
    const pts = weekdays("2026-11-02", "2026-11-13", (_iso, i) => i + 1, ["2026-11-10"]);
    const m = buildPeriodLedger(pts); // 9 observed days: 1..9
    expect(m.tail(5)).toEqual({ value: 7, days: 5 }); // 5,6,7,8,9
    expect(m.tailPrev(5)).toEqual({ value: null, days: 0 });
    const m2 = buildPeriodLedger([...pts, { date: "2026-11-16", value: 10 }]);
    expect(m2.tailPrev(5)).toEqual({ value: 3, days: 5 }); // 1..5
  });

  it("averages one latest value per weekday for Mon–Fri Avg (Latest)", () => {
    // Fri 13 Nov is a holiday, so the latest Friday is 6 Nov.
    const pts = weekdays("2026-11-02", "2026-11-12", (iso) => Number(iso.slice(8, 10)));
    const m = buildPeriodLedger(pts);
    // latest Mon 9, Tue 10, Wed 11, Thu 12, Fri 6
    expect(m.latestWeek().value).toBeCloseTo((9 + 10 + 11 + 12 + 6) / 5, 9);
  });

  it("compares a weekday's latest value with its own last 3 and last 10", () => {
    const pts = weekdays("2026-08-03", "2026-11-13", (_iso, i) => 100 + i);
    const d = buildPeriodLedger(pts).day("Monday");
    const mondays = pts.filter((p) => new Date(`${p.date}T00:00:00Z`).getUTCDay() === 1).map((p) => p.value);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(d.latest.value).toBe(mondays.at(-1));
    expect(d.short.value).toBeCloseTo(avg(mondays.slice(-3)), 9);
    expect(d.long.value).toBeCloseTo(avg(mondays.slice(-10)), 9);
    expect(d.doShort).toBeCloseTo(mondays.at(-1)! / avg(mondays.slice(-3)) - 1, 12);
  });

  it("defaults quarter row 4 to the same quarter a year earlier, else the fifth-latest", () => {
    const m = buildPeriodLedger(weekdays("2025-07-01", "2026-11-06", () => 1));
    expect(m.defaults().q).toEqual(["Q3 FY 2027", "Q2 FY 2027", "Q1 FY 2027", "Q3 FY 2026"]);
    expect(m.defaults().wq).toEqual(["Q3 FY 2027", "Q2 FY 2027", "Q3 FY 2026"]);
    // No Q3 a year back: fall back to the fifth-latest quarter (index n-5 clamped to 0).
    const short = buildPeriodLedger(weekdays("2026-01-01", "2026-11-06", () => 1));
    expect(short.quarters).toEqual(["Q4 FY 2026", "Q1 FY 2027", "Q2 FY 2027", "Q3 FY 2027"]);
    expect(short.defaults().q[3]).toBe("Q4 FY 2026");
    expect(short.defaults().fy).toEqual(["FY 2027", "FY 2026"]);
  });

  it("gives a weekday's QoQ and YoY from its quarter averages, YoY null without that quarter", () => {
    const pts = weekdays("2026-04-01", "2026-11-06", (iso) => (iso >= "2026-10-01" ? 120 : 100));
    const x = buildPeriodLedger(pts).dayQuarter("Wednesday");
    expect(x.curLabel).toBe("Q3 FY 2027");
    expect(x.qoq).toBeCloseTo(0.2, 12);
    expect(x.yoyLabel).toBeNull();
    expect(x.yoy).toBeNull();
  });

  it("takes Avg 6M as the 125 observed days ending on the month's last observed day", () => {
    const pts = weekdays("2026-01-01", "2026-11-06", (_iso, i) => i);
    const m = buildPeriodLedger(pts);
    const octEnd = pts.findLastIndex((p) => p.date.startsWith("2026-10"));
    const window = pts.slice(octEnd - 124, octEnd + 1).map((p) => p.value);
    expect(m.half("FY 2027 October").days).toBe(125);
    expect(m.half("FY 2027 October").value).toBeCloseTo(window.reduce((a, b) => a + b, 0) / 125, 9);
  });
});

describe("formatting", () => {
  it("shows % changes to 1 decimal with no + sign, tone from the rounded figure", () => {
    expect(formatLedgerPct(0.1304)).toEqual({ text: "13.0%", tone: "pos" });
    expect(formatLedgerPct(-0.0264)).toEqual({ text: "-2.6%", tone: "neg" });
    expect(formatLedgerPct(-0.0004)).toEqual({ text: "0.0%", tone: "neu" });
    expect(formatLedgerPct(null)).toBeNull();
    expect(ledgerChange(110, 0)).toBeNull();
    expect(ledgerChange(110, 100)).toBeCloseTo(0.1, 12);
  });

  it("formats ₹ Cr with Indian grouping and no decimals", () => {
    expect(formatLedgerInr(456910.4)).toBe("4,56,910");
    expect(formatLedgerInr(null)).toBe("—");
  });
});

describe("toLedgerPoints", () => {
  it("drops Muhurat and DR test sessions but keeps full weekend trading days", () => {
    const pts = toLedgerPoints([
      { date: "2024-01-20", liveAumCr: 1 },
      { date: "2024-03-02", liveAumCr: 2 },
      { date: "2024-11-01", liveAumCr: 3 },
      { date: "2026-02-01", liveAumCr: 4 },
    ]);
    expect(pts.map((p) => p.date)).toEqual(["2024-01-20", "2026-02-01"]);
  });
});
