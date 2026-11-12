import { describe, expect, it } from "vitest";
import { computeSipGrowth, computeSipShare, effectiveSipValues, type SipFive } from "./sip-growth";

// HDFC's Fortnightly figures on 2026-11-11 (₹ Cr).
const AMC: SipFive = [14400, 14430, 14640, 13530, 12030];
const INDUSTRY: SipFive = [96748, 93850, 92934, 86090, 80589];
const LABELS = ["Q2FY27", "Q1FY27", "Q4FY26", "Q2FY26", "Q1FY26"];

describe("computeSipGrowth", () => {
  it("matches the Fortnightly card: step and YoY on the first two rows only", () => {
    const g = computeSipGrowth(AMC);
    expect(g.step[0]).toBeCloseTo(14400 / 14430 - 1, 12);
    expect(g.step[1]).toBeCloseTo(14430 / 14640 - 1, 12);
    expect(g.yoy[0]).toBeCloseTo(14400 / 13530 - 1, 12);
    expect(g.yoy[1]).toBeCloseTo(14430 / 12030 - 1, 12);
    expect(g.step.slice(2)).toEqual([null, null, null]);
    expect(g.yoy.slice(2)).toEqual([null, null, null]);
  });

  it("adds row 2's QoQ and YoY when its bases are given", () => {
    // Industry Q4FY26 vs Q3FY26 and Q4FY25 (AMFI).
    const g = computeSipGrowth(INDUSTRY, { prev: 89976, yoy: 78325 });
    expect(g.step[2]).toBeCloseTo(92934 / 89976 - 1, 12);
    expect(g.yoy[2]).toBeCloseTo(92934 / 78325 - 1, 12);
    expect(g.step[0]).toBeCloseTo(96748 / 93850 - 1, 12);
    expect(computeSipGrowth(INDUSTRY, { prev: null, yoy: 0 }).step[2]).toBeNull();
    expect(computeSipGrowth(INDUSTRY, { prev: null, yoy: 0 }).yoy[2]).toBeNull();
  });

  it("leaves a change blank when either side is missing or the base is zero", () => {
    const g = computeSipGrowth([100, null, 50, 0, 40]);
    expect(g.step).toEqual([null, null, null, null, null]);
    expect(g.yoy[0]).toBeNull();
    expect(g.yoy[1]).toBeNull();
  });
});

describe("effectiveSipValues", () => {
  it("uses the typed value over the auto one, and the auto one when blank", () => {
    expect(effectiveSipValues([1, null, 3, null, null], [10, 20, 30, null, 50])).toEqual([1, 20, 3, null, 50]);
  });
});

describe("computeSipShare", () => {
  it("divides AMC by industry SIP when the periods match", () => {
    const share = computeSipShare(AMC, LABELS, INDUSTRY, LABELS);
    expect(share[0]).toBeCloseTo(0.1488, 4);
    expect(share[2]).toBeCloseTo(0.1575, 4);
  });

  it("shows nothing for periods that don't line up, or without industry data", () => {
    const shifted = ["Q1FY27", "Q4FY26", "Q3FY26", "Q1FY26", "Q4FY25"];
    expect(computeSipShare(AMC, LABELS, INDUSTRY, shifted)).toEqual([null, null, null, null, null]);
    expect(computeSipShare(AMC, LABELS, INDUSTRY, null)).toEqual([null, null, null, null, null]);
    expect(computeSipShare([1, null, 1, 1, 1], LABELS, [0, 1, null, 1, 1], LABELS)).toEqual([null, null, null, 1, 1]);
  });
});
