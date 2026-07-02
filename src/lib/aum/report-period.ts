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
