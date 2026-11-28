import { describe, expect, it } from "vitest";
import { nextWeekCalendar, nextWeekWindow, shortDate } from "./next-week";

describe("nextWeekCalendar", () => {
  it("lists the month close in the coming week and the next AMFI and vendor releases", () => {
    const cal = nextWeekCalendar("2026-11-27", { latestFlowMonthEnd: "2026-10-31", reportedThrough: "2026-10" });
    expect({ from: cal.from, to: cal.to }).toEqual({ from: "2026-11-30", to: "2026-12-04" });
    const byTitle = Object.fromEntries(cal.items.map((i) => [i.title, i]));
    expect(byTitle["November closes"].date).toBe("2026-11-30");
    expect(byTitle["AMFI November data"].date).toBe("2026-12-08");
    expect(byTitle["AMFI November data"].detail).toContain("Expected around 8–10 Dec");
    expect(byTitle["November portfolios (Mirae tracker)"].detail).toContain("after 15 Dec");
    expect(byTitle["November portfolios (Mirae tracker)"].detail).toContain("since 31 Oct");
  });

  it("says when a release is overdue", () => {
    const cal = nextWeekCalendar("2026-12-18", { latestFlowMonthEnd: "2026-10-31", reportedThrough: "2026-10" });
    const titles = cal.items.map((i) => `${i.title}: ${i.detail}`);
    expect(titles.find((t) => t.startsWith("AMFI November"))).toContain("not stored yet");
    expect(titles.find((t) => t.startsWith("November portfolios"))).toContain("not imported yet");
  });

  it("adds no release items without release state, and flags quarter-end", () => {
    const cal = nextWeekCalendar("2026-12-24");
    expect(cal.items.some((i) => i.title.startsWith("AMFI"))).toBe(false);
    expect(cal.items.map((i) => i.title)).toContain("Quarter-end");
  });
});

describe("dates", () => {
  it("formats and windows", () => {
    expect(shortDate("2026-11-30")).toBe("Mon 30 Nov");
    expect(nextWeekWindow("2026-11-28")).toEqual({ from: "2026-11-30", to: "2026-12-04" });
  });
});
