import { describe, expect, it } from "vitest";
import { calendarDaysBetween, classifyForeignPriceAge, worseTier } from "./foreign-price-age";

describe("foreign price age tiers", () => {
  it("counts calendar days between IST dates", () => {
    expect(calendarDaysBetween("2026-11-03", "2026-11-03")).toBe(0);
    expect(calendarDaysBetween("2026-10-30", "2026-11-03")).toBe(4);
    expect(calendarDaysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(calendarDaysBetween("not-a-date", "2026-11-03")).toBeNull();
  });

  it("keeps a weekend-old quote fresh, flags 4-7 days, expires after 7", () => {
    expect(classifyForeignPriceAge(0)).toBe("fresh");
    expect(classifyForeignPriceAge(3)).toBe("fresh");
    expect(classifyForeignPriceAge(4)).toBe("stale");
    expect(classifyForeignPriceAge(7)).toBe("stale");
    expect(classifyForeignPriceAge(8)).toBe("expired");
    expect(classifyForeignPriceAge(null)).toBe("fresh"); // unknown as-of date: pre-tier behaviour
  });

  it("a quote is only as fresh as its FX rate", () => {
    expect(worseTier("fresh", "stale")).toBe("stale");
    expect(worseTier("expired", "fresh")).toBe("expired");
    expect(worseTier("fresh", "fresh")).toBe("fresh");
  });
});
