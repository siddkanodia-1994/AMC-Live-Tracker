import { describe, expect, it } from "vitest";
import { isSipSlotField, lastFilledIndex, matrixQuarters, overlayCardSlots, quarterKey, slotQuarter, yoyOfLatest } from "./sip-quarterly-matrix";
import { getSipAmcPeriodLabels } from "./sip-industry-settings";
import { quarterLabel } from "./industry-sip";

const Q2FY27 = { fy: 2027, q: 2 };

describe("slotQuarter", () => {
  it("matches the card's own labels for every slot", () => {
    const labels = getSipAmcPeriodLabels(2027, 2);
    expect([0, 1, 2, 3, 4].map((s) => quarterLabel(slotQuarter(Q2FY27, s)))).toEqual([
      labels.qtd,
      labels.prevQ,
      labels.prevQ2,
      labels.yoyQ,
      labels.yoyQ2,
    ]);
  });

  it("crosses fiscal years (anchor Q1FY27)", () => {
    const labels = getSipAmcPeriodLabels(2027, 1);
    expect([0, 1, 2, 3, 4].map((s) => quarterLabel(slotQuarter({ fy: 2027, q: 1 }, s)))).toEqual([
      labels.qtd,
      labels.prevQ,
      labels.prevQ2,
      labels.yoyQ,
      labels.yoyQ2,
    ]);
  });

  it("knows which card fields are SIP slots", () => {
    expect(isSipSlotField("sipAmcQtdValCr")).toBe(true);
    expect(isSipSlotField("sipAmcYoyQ2Pct")).toBe(true);
    expect(isSipSlotField("sipAmcLatestQuarter")).toBe(false);
    expect(isSipSlotField("targetPeBase")).toBe(false);
  });
});

describe("overlayCardSlots", () => {
  it("the card's figures win for its 5 quarters; older stored ones stay", () => {
    const stored = {
      "2025-1": { sipCr: null, sipEqAumPct: 0.089 },
      "2027-2": { sipCr: 1, sipEqAumPct: 0.5 },
      "2026-3": { sipCr: 999, sipEqAumPct: 0.094 },
    };
    const out = overlayCardSlots(stored, Q2FY27, {
      sipCr: [14400, 14430, 14640, 13530, 12030],
      sipEqAumPct: [0.089, 0.094, 0.097, 0.095, null],
    });
    expect(out["2027-2"]).toEqual({ sipCr: 14400, sipEqAumPct: 0.089 });
    expect(out["2026-1"]).toEqual({ sipCr: 12030, sipEqAumPct: null });
    // Q3FY26 isn't one of the card's slots, so the stored row shows.
    expect(out["2026-3"]).toEqual({ sipCr: 999, sipEqAumPct: 0.094 });
    expect(out["2025-1"]).toEqual({ sipCr: null, sipEqAumPct: 0.089 });
  });

  it("a blank card cell falls back to the stored figure", () => {
    const out = overlayCardSlots({ "2027-1": { sipCr: 500, sipEqAumPct: 0.1 } }, Q2FY27, {
      sipCr: [null, null, null, null, null],
      sipEqAumPct: [null, null, null, null, null],
    });
    expect(out["2027-1"]).toEqual({ sipCr: 500, sipEqAumPct: 0.1 });
  });
});

describe("matrixQuarters and YoY", () => {
  it("runs from Q1FY25 to the latest quarter", () => {
    const qs = matrixQuarters(Q2FY27);
    expect(qs.map((q) => q.label)).toEqual(["Q1FY25", "Q2FY25", "Q3FY25", "Q4FY25", "Q1FY26", "Q2FY26", "Q3FY26", "Q4FY26", "Q1FY27", "Q2FY27"]);
    expect(qs[9].key).toBe(quarterKey(Q2FY27));
    expect(matrixQuarters({ fy: 2024, q: 4 })).toHaveLength(1);
  });

  it("YoY compares the latest with 4 quarters earlier", () => {
    expect(yoyOfLatest([0.089, 0.089, 0.09, 0.089, 0.09, 0.095])).toBeCloseTo(0.095 / 0.089 - 1, 12);
    expect(yoyOfLatest([0.1, 0.1, 0.1])).toBeNull();
    expect(yoyOfLatest([null, 1, 1, 1, 1])).toBeNull();
  });

  it("YoY falls back to the last quarter with a figure while the newest is blank", () => {
    // Q1FY26 … Q3FY27, Q3FY27 not reported yet: Q2FY27 vs Q2FY26.
    const hdfcShare = [0.149, 0.157, null, 0.158, 0.154, 0.149, null];
    expect(lastFilledIndex(hdfcShare)).toBe(5);
    expect(yoyOfLatest(hdfcShare)).toBeCloseTo(0.149 / 0.157 - 1, 12);
    expect(yoyOfLatest([0.1, 0.1, 0.1, 0.1, null, null])).toBeNull();
    expect(lastFilledIndex([null, null])).toBe(-1);
  });
});
