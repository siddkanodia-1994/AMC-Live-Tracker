import { describe, expect, it } from "vitest";
import { expectedReportPeriod } from "./probe";

describe("expectedReportPeriod", () => {
  it("expects month M's vendor file only after the 15th of M+1", () => {
    expect(expectedReportPeriod("2026-11-03")).toEqual({ period: "2026-09", graceOver: false });
    expect(expectedReportPeriod("2026-11-16")).toEqual({ period: "2026-10", graceOver: false });
    expect(expectedReportPeriod("2026-11-25")).toEqual({ period: "2026-10", graceOver: true });
    expect(expectedReportPeriod("2027-01-20")).toEqual({ period: "2026-12", graceOver: false });
  });
});
