import { describe, expect, it } from "vitest";
import { computeProvisionalFill, firstQuarterEndBetween, withLiveValuationPoint } from "./provisional";

describe("computeProvisionalFill", () => {
  it("holds the anchor's TTM EPS and sales per share and rescales by price (HDFC, 4 Nov 2026)", () => {
    const fill = computeProvisionalFill([{ date: "2026-11-04", pe: 36.1, mcapToSales: 24.4 }], [
      { date: "2026-11-04", priceInr: 2505 },
      { date: "2026-11-05", priceInr: 2640 },
      { date: "2026-11-06", priceInr: 2649.8 },
    ]);
    expect(fill.points.map((p) => p.date)).toEqual(["2026-11-05", "2026-11-06"]);
    expect(fill.points[0].pe).toBeCloseTo(38.05, 2); // 2640 / (2505 / 36.1)
    expect(fill.points[1].pe).toBeCloseTo(38.19, 2);
    expect(fill.points[1].mcapToSales).toBeCloseTo(25.81, 2); // 2649.8 / (2505 / 24.4)
    expect(fill.points.every((p) => p.provisional)).toBe(true);
    expect(fill.staleSince).toBeNull();
  });

  it("matches Ace within 0.2% inside a quarter (HDFC 1 Oct -> 5 Oct 2026)", () => {
    const [p] = computeProvisionalFill([{ date: "2026-10-01", pe: 33.3, mcapToSales: null }], [
      { date: "2026-10-01", priceInr: 2308.1 },
      { date: "2026-10-05", priceInr: 2346 },
    ]).points;
    expect(Math.abs(p.pe! / 33.8 - 1)).toBeLessThan(0.002); // Ace's own value that day: 33.8
    expect(p.mcapToSales).toBeNull(); // no anchor value -> left empty, not invented
  });

  it("uses the latest close on or before the anchor when the anchor day has no price", () => {
    const fill = computeProvisionalFill([{ date: "2026-11-04", pe: 20, mcapToSales: 10 }], [
      { date: "2026-11-03", priceInr: 100 },
      { date: "2026-11-05", priceInr: 110 },
    ]);
    expect(fill.points[0].pe).toBeCloseTo(22, 9);
    expect(fill.points[0].mcapToSales).toBeCloseTo(11, 9);
  });

  it("returns nothing without an anchor close, without later prices, or without usable anchor values", () => {
    expect(computeProvisionalFill([{ date: "2026-11-04", pe: 20, mcapToSales: 10 }], [{ date: "2026-11-05", priceInr: 110 }]).points).toEqual([]);
    expect(computeProvisionalFill([{ date: "2026-11-04", pe: 20, mcapToSales: 10 }], [{ date: "2026-11-04", priceInr: 100 }]).points).toEqual([]);
    expect(
      computeProvisionalFill([{ date: "2026-11-04", pe: null, mcapToSales: 0 }], [
        { date: "2026-11-04", priceInr: 100 },
        { date: "2026-11-05", priceInr: 110 },
      ]).points
    ).toEqual([]);
  });

  it("flags the first quarter-end the fill runs past", () => {
    const fill = computeProvisionalFill([{ date: "2026-12-29", pe: 20, mcapToSales: 10 }], [
      { date: "2026-12-29", priceInr: 100 },
      { date: "2026-12-30", priceInr: 101 },
      { date: "2027-01-02", priceInr: 102 },
    ]);
    expect(fill.staleSince).toBe("2026-12-31");
  });
});

describe("computeProvisionalFill anchoring", () => {
  it("takes the median implied figure over the last 5 Ace days of the same quarter", () => {
    const rows = [
      { date: "2026-09-29", pe: 10, mcapToSales: 10 }, // previous quarter: ignored
      { date: "2026-10-01", pe: 10, mcapToSales: null },
      { date: "2026-10-02", pe: 10.1, mcapToSales: null },
      { date: "2026-10-05", pe: 9.9, mcapToSales: null },
    ];
    const prices = ["2026-09-29", "2026-10-01", "2026-10-02", "2026-10-05"].map((date) => ({ date, priceInr: 100 }));
    const fill = computeProvisionalFill(rows, [...prices, { date: "2026-10-06", priceInr: 110 }]);
    // implied EPS 10, 9.90, 10.10 -> median 10 -> 110 / 10 = 11
    expect(fill.points[0].pe).toBeCloseTo(11, 9);
    expect(fill.points[0].mcapToSales).toBeNull(); // the only Mcap/Sales value is in the previous quarter
  });

  it("starts a new regime on the quarter-end day itself (Ace rolls earnings on that row)", () => {
    const rows = [
      { date: "2026-09-28", pe: 30, mcapToSales: null }, // old TTM EPS: 990 / 30 = 33
      { date: "2026-09-29", pe: 30, mcapToSales: null },
      { date: "2026-09-30", pe: 22, mcapToSales: null }, // new TTM EPS: 990 / 22 = 45
    ];
    const prices = ["2026-09-28", "2026-09-29", "2026-09-30"].map((date) => ({ date, priceInr: 990 }));
    const fill = computeProvisionalFill(rows, [...prices, { date: "2026-10-01", priceInr: 1080 }]);
    expect(fill.points[0].pe).toBeCloseTo(24, 9); // 1080 / 45, not 1080 / 33
    expect(fill.staleSince).toBeNull();
  });
});

describe("firstQuarterEndBetween", () => {
  it("finds quarter-ends strictly after the start and up to the end date", () => {
    expect(firstQuarterEndBetween("2026-11-04", "2026-11-06")).toBeNull();
    expect(firstQuarterEndBetween("2026-09-29", "2026-10-06")).toBe("2026-09-30");
    expect(firstQuarterEndBetween("2026-09-30", "2026-10-06")).toBeNull(); // anchor on the quarter-end itself
    expect(firstQuarterEndBetween("2026-11-04", "2027-04-02")).toBe("2026-12-31");
  });
});

describe("withLiveValuationPoint", () => {
  const closes = [
    { date: "2026-11-06", priceInr: 2500 },
    { date: "2026-11-09", priceInr: 2619.6 },
  ];
  const points = [
    { date: "2026-11-05", pe: 40, mcapToSales: 20 },
    { date: "2026-11-06", pe: 41, mcapToSales: 21, provisional: true },
    { date: "2026-11-09", pe: 42.96, mcapToSales: 22, provisional: true },
  ];

  it("appends today re-priced from the latest earlier provisional day", () => {
    const out = withLiveValuationPoint(points, { date: "2026-11-11", priceInr: 2692.8 }, closes);
    expect(out).toHaveLength(4);
    expect(out[3].date).toBe("2026-11-11");
    expect(out[3].pe).toBeCloseTo((42.96 * 2692.8) / 2619.6, 10);
    expect(out[3].mcapToSales).toBeCloseTo((22 * 2692.8) / 2619.6, 10);
  });

  it("replaces a stored today point instead of adding another", () => {
    const withToday = [...points, { date: "2026-11-11", pe: 43.5, mcapToSales: 22.3, provisional: true }];
    const out = withLiveValuationPoint(withToday, { date: "2026-11-11", priceInr: 2692.8 }, closes);
    expect(out).toHaveLength(4);
    expect(out[3].pe).toBeCloseTo((42.96 * 2692.8) / 2619.6, 10);
  });

  it("leaves real Ace data, no live price and later data untouched", () => {
    const ace = points.slice(0, 1);
    expect(withLiveValuationPoint(ace, { date: "2026-11-11", priceInr: 1 }, closes)).toBe(ace);
    expect(withLiveValuationPoint(points, undefined, closes)).toBe(points);
    expect(withLiveValuationPoint(points, { date: "2026-11-08", priceInr: 1 }, closes)).toBe(points);
  });
});
