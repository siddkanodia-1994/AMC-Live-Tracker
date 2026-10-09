// Shared trailing-date-range selector logic used by AumTrendChart and the
// Stock Correlation table -- kept in one place so "2 years" resolves to the
// exact same cutoff date wherever it's selected, rather than two components
// each rolling their own slightly-different definition.
export type RangeOption = "6m" | "1y" | "2y" | "3y" | "all";

export const RANGE_OPTIONS: { value: RangeOption; label: string; months: number | null }[] = [
  { value: "6m", label: "6M", months: 6 },
  { value: "1y", label: "1Y", months: 12 },
  { value: "2y", label: "2Y", months: 24 },
  { value: "3y", label: "3Y", months: 36 },
  { value: "all", label: "All", months: null },
];

// Pure year/month arithmetic, not JS Date month-rollover (`setUTCMonth`
// silently overflows into the next month when the source day doesn't exist
// in the target month -- e.g. Oct 31 minus 1 month landed back on Oct 1
// instead of Sep 30). Clamps the day to the target month's real last day.
export function subtractMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const totalMonths = y * 12 + (m - 1) - months;
  const newY = Math.floor(totalMonths / 12);
  const newM0 = ((totalMonths % 12) + 12) % 12;
  const lastDayOfNewMonth = new Date(Date.UTC(newY, newM0 + 1, 0)).getUTCDate();
  const newD = Math.min(d, lastDayOfNewMonth);
  return `${newY}-${String(newM0 + 1).padStart(2, "0")}-${String(newD).padStart(2, "0")}`;
}

// The cutoff date `filterByRange` would use for this exact series, measured
// back from ITS OWN latest date -- exposed separately so a caller with two
// (or more) related series that don't necessarily share the same latest
// date (e.g. an AMC's AUM history vs. its share-price history, which can be
// a day or two out of sync) can derive ONE canonical cutoff from whichever
// series they treat as the reference, then apply it to all of them via
// filterByCutoff -- otherwise each series would independently pick a
// slightly different start date and produce subtly different stats for
// what's supposed to be "the same 3-year window". Returns null for "all"
// (no cutoff) or an empty series.
export function computeRangeCutoffDate(points: { date: string }[], range: RangeOption): string | null {
  if (points.length === 0) return null;
  const option = RANGE_OPTIONS.find((o) => o.value === range);
  if (!option || option.months === null) return null;
  return subtractMonths(points[points.length - 1].date, option.months);
}

// Trims `points` to the trailing window implied by `range`, measured back
// from the series' OWN latest date (not `new Date()`) so behavior stays
// deterministic. "all" is a no-op. Use filterByCutoff instead when multiple
// series need to share exactly one cutoff rather than each deriving its own.
export function filterByRange<T extends { date: string }>(points: T[], range: RangeOption): T[] {
  return filterByCutoff(points, computeRangeCutoffDate(points, range));
}

export function filterByCutoff<T extends { date: string }>(points: T[], cutoffDate: string | null): T[] {
  return cutoffDate ? points.filter((p) => p.date >= cutoffDate) : points;
}
