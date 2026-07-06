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
