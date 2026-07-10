// "Since last report" window start: the 1st of the month after the current
// report period (e.g. reportPeriod "2026-05" -> "2026-06-01"). Used both by
// the backfill job and the average-AUM-since-report query so the window
// definition can't drift between the two.
export function firstDayOfNextMonth(reportPeriod: string): string {
  const [year, month] = reportPeriod.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// Last calendar day of a report period's own month (e.g. reportPeriod
// "2026-05" -> "2026-05-31"). Used by the net-flow estimate to find "the
// last day the prior period's holdings were the ones actually being priced".
export function lastDayOfReportMonth(reportPeriod: string): string {
  const [year, month] = reportPeriod.split("-").map(Number);
  const days = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return `${reportPeriod}-${String(days).padStart(2, "0")}`;
}

interface QuarterBounds {
  start: string;
  end: string;
}

function fiscalQuarterStartMonth(month: number): number {
  if (month >= 4 && month <= 6) return 4;
  if (month >= 7 && month <= 9) return 7;
  if (month >= 10 && month <= 12) return 10;
  return 1; // Jan-Mar
}

// Indian fiscal year starts 1 April: Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec,
// Q4 Jan-Mar -- each quarter's calendar dates fall entirely within one
// calendar year regardless of FY numbering, so no year-rollover handling
// is needed here (only getPreviousFiscalQuarterBounds crosses a year, when
// stepping back from Q4/Jan-Mar into the prior year's Oct-Dec).
export function getFiscalQuarterBounds(dateStr: string): QuarterBounds {
  const [year, month] = dateStr.split("-").map(Number);
  const startMonth = fiscalQuarterStartMonth(month);
  const endMonth = startMonth + 2;
  const endDay = endMonth === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[endMonth - 1];
  return {
    start: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    end: `${year}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
  };
}

// The fiscal quarter immediately before the one containing `dateStr` --
// e.g. "2026-07-10" (Jul-Sep 2026) -> Apr-Jun 2026; "2026-04-15" (Apr-Jun
// 2026) -> Jan-Mar 2026; "2026-01-05" (Jan-Mar 2026) -> Oct-Dec 2025.
export function getPreviousFiscalQuarterBounds(dateStr: string): QuarterBounds {
  const { start } = getFiscalQuarterBounds(dateStr);
  const [year, month] = start.split("-").map(Number);
  const prevStartMonth = month === 1 ? 10 : month - 3;
  const prevYear = month === 1 ? year - 1 : year;
  return getFiscalQuarterBounds(`${prevYear}-${String(prevStartMonth).padStart(2, "0")}-01`);
}

// Most recent date in a sorted-ascending list that's <= target, or the
// earliest available date if none qualify (never returns null when the list
// is non-empty) -- mirrors the same "closest available on or before" leniency
// the underlying liveAumDailySnapshot queries already use (ORDER BY DESC
// LIMIT 1 with a <= filter), so client-side date snapping stays consistent
// with what the server would actually resolve for the same input.
export function closestDateAtOrBefore(sortedAscDates: string[], target: string): string | null {
  if (sortedAscDates.length === 0) return null;
  let result: string | null = null;
  for (const d of sortedAscDates) {
    if (d <= target) result = d;
    else break;
  }
  return result ?? sortedAscDates[0];
}
