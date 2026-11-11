import { describe, expect, it } from "vitest";
import { livePointsBySlug, previousClose, withLivePoint } from "./live-point";
import type { AmcStockCorrelationEntry } from "./correlation-summary";
import type { LiveAumSnapshot } from "../aum/types";

const aum = (date: string, liveAumCr: number) => ({ date, liveAumCr, reportedAumCr: 400000, reportPeriod: "2026-10" }) as AmcStockCorrelationEntry["aumHistory"][number];

function entry(lastDate: string): AmcStockCorrelationEntry {
  return {
    slug: "hdfc-mutual-fund",
    overviewName: "HDFC Mutual Fund",
    tradingSymbol: "HDFCAMC",
    aumHistory: [aum("2026-11-09", 450000), aum(lastDate, 455000)],
    stockPriceSeries: [
      { date: "2026-11-09", priceInr: 2619.6 },
      { date: lastDate, priceInr: 2680 },
    ],
  };
}

describe("withLivePoint", () => {
  it("replaces today's price and AUM with the live point", () => {
    const e = withLivePoint(entry("2026-11-11"), { date: "2026-11-11", priceInr: 2692.8, liveAumCr: 456910 });
    expect(e.stockPriceSeries).toEqual([
      { date: "2026-11-09", priceInr: 2619.6 },
      { date: "2026-11-11", priceInr: 2692.8 },
    ]);
    expect(e.aumHistory.at(-1)).toMatchObject({ date: "2026-11-11", liveAumCr: 456910, reportedAumCr: 400000 });
    expect(e.aumHistory).toHaveLength(2);
  });

  it("appends today when the histories stop at the last close", () => {
    const e = withLivePoint(entry("2026-11-10"), { date: "2026-11-11", priceInr: 2692.8, liveAumCr: 456910 });
    expect(e.stockPriceSeries.at(-1)).toEqual({ date: "2026-11-11", priceInr: 2692.8 });
    expect(e.stockPriceSeries).toHaveLength(3);
    expect(e.aumHistory.at(-1)).toMatchObject({ date: "2026-11-11", liveAumCr: 456910 });
  });

  it("keeps today's AUM as loaded when no live AUM is given, and leaves the entry alone without a point", () => {
    const base = entry("2026-11-11");
    const e = withLivePoint(base, { date: "2026-11-11", priceInr: 2692.8, liveAumCr: null });
    expect(e.aumHistory).toBe(base.aumHistory);
    expect(withLivePoint(base, undefined)).toBe(base);
  });

  it("never rewrites history newer than the live point", () => {
    const base = entry("2026-11-12");
    expect(withLivePoint(base, { date: "2026-11-11", priceInr: 1, liveAumCr: 1 })).toBe(base);
  });
});

describe("livePointsBySlug", () => {
  const prices = { date: "2026-11-11", marketOpen: true, prices: [{ slug: "hdfc-mutual-fund", tradingSymbol: "HDFCAMC", priceInr: 2692.8, computedAt: "2026-11-11T05:10:00Z" }] };
  const live = (computedAt: string) => ({ computedAt, amcs: [{ slug: "hdfc-mutual-fund", liveAumCr: 456910 }] }) as unknown as LiveAumSnapshot;

  it("pairs the live price with today's live AUM", () => {
    expect(livePointsBySlug(prices, live("2026-11-11T05:11:00Z")).get("hdfc-mutual-fund")).toEqual({ date: "2026-11-11", priceInr: 2692.8, liveAumCr: 456910 });
  });

  it("drops a live AUM snapshot from another day (IST)", () => {
    // 2026-11-10 20:00 UTC is 11 Nov 01:30 IST, still "today"; 18:00 UTC is 10 Nov 23:30 IST.
    expect(livePointsBySlug(prices, live("2026-11-10T20:00:00Z")).get("hdfc-mutual-fund")?.liveAumCr).toBe(456910);
    expect(livePointsBySlug(prices, live("2026-11-10T18:00:00Z")).get("hdfc-mutual-fund")?.liveAumCr).toBeNull();
    expect(livePointsBySlug(undefined, undefined).size).toBe(0);
  });
});

describe("previousClose", () => {
  it("is the last price before the date", () => {
    expect(previousClose(entry("2026-11-11").stockPriceSeries, "2026-11-11")).toBe(2619.6);
    expect(previousClose([], "2026-11-11")).toBeNull();
  });
});
