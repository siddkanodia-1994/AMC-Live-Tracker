import { describe, expect, it } from "vitest";
import type { WeeklyCommentary, WeeklyReportData } from "./types";
import { resolvePath, verifyCommentary } from "./verify";

const DATA = {
  industry: { qoq: 0.0010486, quarters: [{ label: "Q2 FY 2027", value: 3828029.2 }, { label: "Q3 FY 2027", value: 3832043.6 }], last5: 4022640.4 },
  quarter: { sessions: 39 },
  amcs: [
    {
      short: "Motilal",
      slug: "motilal-oswal-mutual-fund",
      aum: { qoq: 0.02711, qCur: { value: 105695.4, days: 39 } },
      share: { qoqBps: 7.2, quarters: [{ label: "Q3 FY 2027", share: 0.027582 }] },
      price: { close: 1222.15, sinceQuarterStart: 0.2297 },
      ratio: { levels: [{ sd: 2, price: 2303.4 }, { sd: -1, price: 992.1 }] },
      earnings: { peNow: 27.31, peZ: 0.41 },
    },
    { short: "UTI", slug: "uti-mutual-fund", aum: { qoq: -0.02426 } },
  ],
} as unknown as WeeklyReportData;

const one = (lead: string, text: string, refs: string[]): WeeklyCommentary => ({ takeaways: [{ lead, text, refs }], sections: {} });

describe("resolvePath", () => {
  it("walks objects, names, negative indexes and key:value", () => {
    expect(resolvePath(DATA, "amcs.Motilal.aum.qoq")).toBe(0.02711);
    expect(resolvePath(DATA, "amcs.uti-mutual-fund.aum.qoq")).toBe(-0.02426);
    expect(resolvePath(DATA, "industry.quarters.-1.value")).toBe(3832043.6);
    expect(resolvePath(DATA, "amcs.Motilal.ratio.levels.sd:-1.price")).toBe(992.1);
    expect(resolvePath(DATA, "amcs.Motilal.share.quarters.Q3 FY 2027.share")).toBe(0.027582);
    expect(resolvePath(DATA, "amcs.Nobody.aum")).toBeUndefined();
  });
});

describe("verifyCommentary", () => {
  it("matches numbers as displayed, with units and signs", () => {
    const r = verifyCommentary(
      DATA,
      one("Motilal keeps gaining.", "Q3 FY27 QTD AUM is ₹1,05,695 Cr over 39 sessions, +2.7% QoQ (UTI −2.4%), share 2.76% (+7 bps); industry ₹40.23 lakh Cr. Price ₹1,222.15, +23.0% since 30 Sep; PE 27.3x, +0.4 SD.", [
        "amcs.Motilal.aum.qCur.value",
        "amcs.Motilal.aum.qoq",
        "amcs.UTI.aum.qoq",
        "amcs.Motilal.share.quarters.-1.share",
        "amcs.Motilal.share.qoqBps",
        "industry.last5",
        "amcs.Motilal.price.close",
        "amcs.Motilal.price.sinceQuarterStart",
        "amcs.Motilal.earnings.peNow",
        "amcs.Motilal.earnings.peZ",
      ])
    );
    expect(r.summary.unmatched).toBe(0);
    expect(r.summary.badRefs).toBe(0);
    expect(r.summary.matched).toBe(10);
    const kinds = Object.fromEntries(r.bullets[0].tokens.map((t) => [t.text, t.kind]));
    expect(kinds["3"]).toBe("label"); // Q3
    expect(kinds["39"]).toBe("label"); // 39 sessions
    expect(kinds["30"]).toBe("label"); // 30 Sep
  });

  it("fails a number that isn't in the cited figures, or has the wrong sign", () => {
    const r = verifyCommentary(DATA, one("UTI.", "UTI is +2.4% QoQ and Motilal +2.8%.", ["amcs.UTI.aum.qoq", "amcs.Motilal.aum.qoq"]));
    expect(r.summary.unmatched).toBe(2);
  });

  it("checks numbers that only look like years or dates", () => {
    // 2,045 has a comma (a figure, not a year); "Market" is not a month.
    const r = verifyCommentary(DATA, one("x", "ICICI closed at 2,045 and the Market grew 47 points.", []));
    expect(r.bullets[0].tokens.map((t) => [t.text, t.kind])).toEqual([
      ["2,045", "unmatched"],
      ["47", "unmatched"],
    ]);
  });

  it("flags refs that don't resolve to a number", () => {
    const r = verifyCommentary(DATA, one("x", "7 of 8 AMCs.", ["amcs.Motilal.aum", "amcs.Nobody.aum.qoq"]));
    expect(r.summary.badRefs).toBe(2);
    expect(r.bullets[0].tokens.map((t) => t.kind)).toEqual(["count", "count"]);
  });
});
