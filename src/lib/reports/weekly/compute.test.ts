import { describe, expect, it } from "vitest";
import type { AmcWeekly } from "./types";
import { lastTradingDateOnOrBefore, tradingDaysBetween, weeklyAlerts } from "./compute";

const amc = (short: string, o: { close?: number; bear?: number; bull?: number; peZ?: number | null; bps?: number | null; noPat?: boolean }) =>
  ({
    short,
    price: { close: o.close ?? 100 },
    targets: { average: { bear: o.bear ?? 90, base: 110, bull: o.bull ?? 130 }, noPat: o.noPat ?? false },
    earnings: { peZ: o.peZ ?? 0 },
    share: { qoqBps: o.bps ?? 0 },
  }) as unknown as AmcWeekly;

describe("weeklyAlerts", () => {
  it("flags closes beyond Bear / Bull, |Z| ≥ 2 and share moves ≥ 10 bps", () => {
    const alerts = weeklyAlerts(
      [amc("HDFC", { close: 2706, bear: 2746, bull: 3379 }), amc("ABSL", { close: 140 }), amc("Motilal", { peZ: 2.1 }), amc("SBI", { bps: -15.4 }), amc("UTI", { bps: 9.9, peZ: -1.9 })],
      -1.52
    );
    expect(alerts.map((a) => `${a.kind}:${a.amc}`)).toEqual(["below-bear:HDFC", "above-bull:ABSL", "pe-z:Motilal", "share-move:SBI"]);
    expect(alerts[0].ref).toBe("amcs.HDFC.targets.average.bear");
  });

  it("raises no target alerts for an AMC without a PAT estimate", () => {
    expect(weeklyAlerts([amc("UTI", { close: 856.55, bear: 993, noPat: true })], null)).toEqual([]);
  });

  it("flags the industry SIP Z only beyond ±2", () => {
    expect(weeklyAlerts([], -2.05).map((a) => a.kind)).toEqual(["sip-z"]);
    expect(weeklyAlerts([], -1.99)).toEqual([]);
  });
});

describe("trading-day helpers", () => {
  it("steps back over weekends and counts sessions", () => {
    expect(lastTradingDateOnOrBefore("2026-11-28")).toBe("2026-11-27");
    expect(tradingDaysBetween("2026-11-27", "2026-12-04")).toBe(5);
  });
});
