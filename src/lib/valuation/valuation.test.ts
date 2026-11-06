import { describe, expect, it } from "vitest";
import { parseValuationRows, type ValuationRow } from "./parse-valuation-workbook";
import { diffValuationRows, summarizeValuationDiff } from "./diff-valuation";
import { computeBands, niceYAxis, rangeTicks } from "./bands";

const HEADER = ["Accord Code", "Company Name", "NDP_Date", "NDP_PE", "NDP_Consolidated PE", "NDP_Consolidated MCAP NS", "NDP_MCAP_NS"];

describe("parseValuationRows", () => {
  it("skips the title and footer, reads Excel day serials as dates, keeps blanks as null", () => {
    const { rows, errors } = parseValuationRows([
      ["Query - Query Expression", null, null, null, null, null, null],
      HEADER,
      [208280, "HDFC Asset Management Company Ltd.", 44480, 32.8, 31.9, 16.4, 16.9],
      [223571, "Canara Robeco Asset Management Co Ltd.", 46330, 19.8, null, null, 9.8],
      [null, null, null, null, null, null, null],
      ["Source:Ace Equity Nxt... Disclaimer", null, null, null, null, null, null],
    ]);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { slug: "hdfc-mutual-fund", date: "2021-10-11", peSa: 32.8, peCons: 31.9, mcapNsCons: 16.4, mcapNsSa: 16.9 },
      { slug: "canara-robeco-mutual-fund", date: "2026-11-04", peSa: 19.8, peCons: null, mcapNsCons: null, mcapNsSa: 9.8 },
    ]);
  });

  it("finds columns by header name, not position", () => {
    const shuffled = [HEADER[2], HEADER[0], HEADER[6], HEADER[5], HEADER[4], HEADER[3]];
    const { rows } = parseValuationRows([shuffled, [44480, 208280, 16.9, 16.4, 31.9, 32.8]]);
    expect(rows[0]).toEqual({ slug: "hdfc-mutual-fund", date: "2021-10-11", peSa: 32.8, peCons: 31.9, mcapNsCons: 16.4, mcapNsSa: 16.9 });
  });

  it("reports unknown codes, bad numbers, duplicates and a missing header", () => {
    const { rows, errors } = parseValuationRows([
      HEADER,
      [999999, "Someone Else", 44480, 1, 1, 1, 1],
      [208280, "HDFC", 44480, "n/a", 1, 1, 1],
      [208280, "HDFC", 44481, 1, 1, 1, 1],
      [208280, "HDFC", 44481, 2, 2, 2, 2],
    ]);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/unknown Accord Code 999999/);
    expect(errors[1]).toMatch(/ndp_pe is not a number/);
    expect(errors[2]).toMatch(/duplicate date 2021-10-12/);
    expect(parseValuationRows([["nothing here"]]).errors[0]).toMatch(/Header row not found/);
  });
});

describe("diffValuationRows", () => {
  const row = (date: string, peCons: number | null, peSa = 30): ValuationRow => ({ slug: "hdfc-mutual-fund", date, peCons, peSa, mcapNsCons: 20, mcapNsSa: 21 });

  it("splits new, revised and unchanged dates and never touches stored dates missing from the file", () => {
    const stored = [row("2026-11-03", 33.1), row("2026-11-04", 33.5), row("2026-10-01", 30)];
    const incoming = [row("2026-11-03", 33.1), row("2026-11-04", 33.4), row("2026-11-05", 33.9)];
    const diff = diffValuationRows(incoming, stored);
    expect(diff.inserts.map((r) => r.date)).toEqual(["2026-11-05"]);
    expect(diff.updates.map((r) => r.date)).toEqual(["2026-11-04"]);
    expect(diff.revisions).toEqual([{ slug: "hdfc-mutual-fund", date: "2026-11-04", field: "peCons", oldValue: 33.5, newValue: 33.4 }]);
    expect(diff.unchanged).toBe(1);
    expect(summarizeValuationDiff(incoming, diff)).toEqual([
      { slug: "hdfc-mutual-fund", inserts: 1, revisedDates: 1, unchanged: 1, firstNewDate: "2026-11-05", lastNewDate: "2026-11-05" },
    ]);
  });

  it("treats a value that only differs past 4 decimals (the DB's precision) as unchanged, and null vs value as a change", () => {
    expect(diffValuationRows([row("2026-11-04", 33.40001)], [row("2026-11-04", 33.4)]).unchanged).toBe(1);
    const diff = diffValuationRows([row("2026-11-04", 33.4)], [row("2026-11-04", null)]);
    expect(diff.revisions).toEqual([{ slug: "hdfc-mutual-fund", date: "2026-11-04", field: "peCons", oldValue: null, newValue: 33.4 }]);
  });
});

describe("computeBands", () => {
  it("uses the sample SD (Excel STDEV.S)", () => {
    const b = computeBands([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(b.mean).toBe(5);
    expect(b.sd).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(b.plus2).toBeCloseTo(5 + 2 * Math.sqrt(32 / 7), 12);
    expect(b.minus1).toBeCloseTo(5 - Math.sqrt(32 / 7), 12);
    expect(b.current).toBe(9);
    expect(b.zScore).toBeCloseTo(4 / Math.sqrt(32 / 7), 12);
  });

  it("needs at least two points and has no z-score for a flat series", () => {
    expect(computeBands([1])).toBeNull();
    expect(computeBands([3, 3, 3])!.zScore).toBeNull();
  });
});

describe("rangeTicks", () => {
  // Weekday sessions from 2024-11-04 to 2026-11-04.
  const dates: string[] = [];
  for (let t = Date.parse("2023-01-02T00:00:00Z"); t <= Date.parse("2026-11-04T00:00:00Z"); t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10));
  }
  const from = (start: string) => dates.filter((d) => d >= start);

  it("ticks weekly on 3M and fortnightly on 6M, labelled dd-Mon", () => {
    const w = rangeTicks(from("2026-08-04"), "3m");
    expect(w.slice(0, 3).map((t) => t.label)).toEqual(["04-Aug", "10-Aug", "17-Aug"]);
    const f = rangeTicks(from("2026-05-04"), "6m");
    expect(f.slice(0, 3).map((t) => t.label)).toEqual(["04-May", "18-May", "01-Jun"]);
  });

  it("ticks monthly on 1Y/2Y, every 2 months on 3Y and quarterly on All, labelled Mon-yy with Sep", () => {
    expect(rangeTicks(from("2025-11-04"), "1y").map((t) => t.label)).toEqual([
      "Nov-25", "Dec-25", "Jan-26", "Feb-26", "Mar-26", "Apr-26", "May-26", "Jun-26", "Jul-26", "Aug-26", "Sep-26", "Oct-26", "Nov-26",
    ]);
    expect(rangeTicks(from("2024-11-04"), "2y")).toHaveLength(25);
    expect(rangeTicks(from("2023-11-06"), "3y").slice(0, 3).map((t) => t.label)).toEqual(["Nov-23", "Jan-24", "Mar-24"]);
    expect(rangeTicks(dates, "all").slice(0, 3).map((t) => t.label)).toEqual(["Jan-23", "Apr-23", "Jul-23"]);
  });

  it("skips a mid-month first point on monthly ranges", () => {
    expect(rangeTicks(from("2025-11-14"), "1y")[0].label).toBe("Dec-25");
  });
});

describe("niceYAxis", () => {
  it("fits the data and every band line on clean gridlines", () => {
    const values = [32.4, 48.9, 40.1, 36.1, 44.2, 35.0];
    const bands = computeBands(values)!;
    const axis = niceYAxis(values, bands);
    expect(axis.min).toBeLessThanOrEqual(Math.min(...values, bands.minus2));
    expect(axis.max).toBeGreaterThanOrEqual(Math.max(...values, bands.plus2));
    expect(axis.min).toBeGreaterThan(0); // no longer pinned to 0
    const steps = axis.ticks.slice(1).map((t, i) => t - axis.ticks[i]);
    steps.forEach((s) => expect(s).toBeCloseTo(steps[0], 9));
    expect(axis.ticks.length).toBeGreaterThanOrEqual(4);
    expect(axis.ticks.length).toBeLessThanOrEqual(9);
  });

  it("never goes below zero", () => {
    const values = [0.4, 1.2, 0.3, 2.5];
    const axis = niceYAxis(values, computeBands(values)!);
    expect(axis.min).toBe(0);
    expect(axis.max).toBeGreaterThanOrEqual(2.5);
  });

  it("gives a flat series a real span", () => {
    const axis = niceYAxis([3, 3, 3], computeBands([3, 3, 3])!);
    expect(axis.min).toBeLessThan(3);
    expect(axis.max).toBeGreaterThan(3);
  });
});
