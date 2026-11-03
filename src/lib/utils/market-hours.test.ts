import { describe, expect, it } from "vitest";
import { hasNseHolidayCalendar, isMarketOpen, isTradingDay, lastTradingDayIstString, msUntilNextMarketOpen } from "./market-hours";

// 10:00 IST on a given IST date.
const istMorning = (date: string) => new Date(`${date}T10:00:00+05:30`);

describe("market-hours", () => {
  it("treats 2026 NSE holidays and weekends as non-trading days", () => {
    expect(isTradingDay(istMorning("2026-01-26"))).toBe(false); // Republic Day
    expect(isTradingDay(istMorning("2026-11-10"))).toBe(false); // Diwali-Balipratipada
    expect(isTradingDay(istMorning("2026-11-07"))).toBe(false); // Saturday
    expect(isTradingDay(istMorning("2026-11-03"))).toBe(true); // ordinary Tuesday
  });

  it("only opens 09:15-15:30 IST on trading days", () => {
    expect(isMarketOpen(new Date("2026-11-03T09:14:00+05:30"))).toBe(false);
    expect(isMarketOpen(new Date("2026-11-03T09:15:00+05:30"))).toBe(true);
    expect(isMarketOpen(new Date("2026-11-03T15:29:00+05:30"))).toBe(true);
    expect(isMarketOpen(new Date("2026-11-03T15:30:00+05:30"))).toBe(false);
    expect(isMarketOpen(new Date("2026-01-26T11:00:00+05:30"))).toBe(false);
  });

  it("looks back across a holiday and across the year boundary", () => {
    expect(lastTradingDayIstString(istMorning("2026-11-11"))).toBe("2026-11-09"); // skips the 10 Nov holiday
    expect(lastTradingDayIstString(istMorning("2027-01-04"))).toBe("2027-01-01"); // NSE trades on 1 Jan
    expect(lastTradingDayIstString(istMorning("2027-01-01"))).toBe("2026-12-31"); // crosses into 2026
  });

  it("finds the next open across a weekend", () => {
    // Friday 16:00 IST -> Monday 09:15 IST = 2d 17h 15m
    expect(msUntilNextMarketOpen(new Date("2026-11-06T16:00:00+05:30"))).toBe(((2 * 24 + 17) * 60 + 15) * 60_000);
  });

  it("reports which years have a holiday list", () => {
    expect(hasNseHolidayCalendar(2026)).toBe(true);
    expect(hasNseHolidayCalendar(2027)).toBe(false); // add once NSE publishes it
  });
});
