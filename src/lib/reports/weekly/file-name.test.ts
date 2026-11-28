import { describe, expect, it } from "vitest";
import { weeklyReportDate, weeklyReportFileBase } from "./file-name";

describe("weeklyReportFileBase", () => {
  it("dates the file on the Saturday of the as-of week", () => {
    expect(weeklyReportFileBase("2026-11-27")).toBe("20261128_Weekly AMC update"); // Friday
    expect(weeklyReportDate("2026-11-26")).toBe("2026-11-28"); // Thursday (Friday a holiday)
    expect(weeklyReportDate("2026-11-23")).toBe("2026-11-28"); // Monday
    expect(weeklyReportDate("2026-11-28")).toBe("2026-11-28"); // a Saturday stays put
  });

  it("crosses month and year ends", () => {
    expect(weeklyReportFileBase("2026-12-31")).toBe("20270102_Weekly AMC update");
    expect(weeklyReportDate("2027-01-29")).toBe("2027-01-30");
  });

  it("rejects a bad date", () => {
    expect(() => weeklyReportDate("2026-13-40")).toThrow();
  });
});
