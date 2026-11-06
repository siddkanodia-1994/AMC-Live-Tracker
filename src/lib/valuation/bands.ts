import type { RangeOption } from "../aum/date-range";

// Pure helpers for the Stock Correlation tab's PE and Mcap/Sales band
// charts: the mean / ±1 / ±2 SD lines over whatever window is shown, and
// x-axis ticks whose spacing follows the selected Range.

export interface Bands {
  mean: number;
  sd: number;
  plus1: number;
  plus2: number;
  minus1: number;
  minus2: number;
  current: number;
  zScore: number | null;
  n: number;
}

/** Sample SD (n - 1), matching Excel's STDEV.S used in the user's own charts. */
export function computeBands(values: number[]): Bands | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1));
  const current = values[n - 1];
  return {
    mean,
    sd,
    plus1: mean + sd,
    plus2: mean + 2 * sd,
    minus1: mean - sd,
    minus2: mean - 2 * sd,
    current,
    zScore: sd === 0 ? null : (current - mean) / sd,
    n,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "04-Aug" -- for the short ranges' weekly ticks. */
export function formatDayMonth(date: string): string {
  const [, m, d] = date.split("-");
  return `${d}-${MONTHS[Number(m) - 1]}`;
}

/** "Nov-25" -- month ticks, as in the user's Excel chart. */
export function formatMonthYear(date: string): string {
  const [y, m] = date.split("-");
  return `${MONTHS[Number(m) - 1]}-${y.slice(2)}`;
}

/** "04-Nov-24" -- the chart title's date span. */
export function formatDayMonthYear(date: string): string {
  return `${formatDayMonth(date)}-${date.slice(2, 4)}`;
}

const TICK_PLAN: Record<RangeOption, { unit: "week" | "month"; every: number; format: (d: string) => string }> = {
  "3m": { unit: "week", every: 1, format: formatDayMonth },
  "6m": { unit: "week", every: 2, format: formatDayMonth },
  "1y": { unit: "month", every: 1, format: formatMonthYear },
  "2y": { unit: "month", every: 1, format: formatMonthYear },
  "3y": { unit: "month", every: 2, format: formatMonthYear },
  all: { unit: "month", every: 3, format: formatMonthYear },
};

function bucketOf(date: string, unit: "week" | "month", every: number): number {
  const [y, m] = date.split("-").map(Number);
  if (unit === "month") return Math.floor((y * 12 + (m - 1)) / every);
  // Monday-based week number since the epoch (1970-01-01 was a Thursday).
  const days = Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  return Math.floor(Math.floor((days + 3) / 7) / every);
}

/**
 * One tick on the first session of each week / fortnight / month / 2 months
 * / quarter (by Range). The very first point only gets a tick when it opens
 * its own bucket (a month that starts within its first week), so a window
 * that begins mid-month doesn't put a stray label hard against the y-axis.
 */
export function rangeTicks(dates: string[], range: RangeOption): { index: number; label: string }[] {
  const plan = TICK_PLAN[range];
  const ticks: { index: number; label: string }[] = [];
  let prev: number | null = null;
  dates.forEach((date, i) => {
    const bucket = bucketOf(date, plan.unit, plan.every);
    if (bucket === prev) return;
    prev = bucket;
    if (i === 0 && plan.unit === "month" && Number(date.slice(8, 10)) > 7) return;
    ticks.push({ index: i, label: plan.format(date) });
  });
  return ticks;
}

/**
 * Y-axis that fits the window shown: spans the series AND all five band
 * lines (so no SD line is ever clipped), padded 5%, snapped to a "nice"
 * step (1 / 2 / 2.5 / 5 x 10^k) for ~5 gridlines, and never below 0.
 * Flat data gets a +/-1 span instead of a zero-height axis.
 */
export function niceYAxis(values: number[], bands: Bands): { min: number; max: number; ticks: number[] } {
  let lo = Math.min(...values, bands.minus2);
  let hi = Math.max(...values, bands.plus2);
  const pad = hi > lo ? (hi - lo) * 0.05 : 1;
  lo -= pad;
  hi += pad;
  const raw = (hi - lo) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  const min = Math.max(0, Math.floor(lo / step) * step);
  const max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let i = 0; min + i * step <= max + step / 1e6; i++) ticks.push(Number((min + i * step).toFixed(6)));
  return { min: ticks[0], max: ticks[ticks.length - 1], ticks };
}
