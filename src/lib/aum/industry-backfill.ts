// The industry-wide equity AUM backfill's maths, DB-free so it's testable:
// the same method as historical-backfill.ts uses for the 8 listed AMCs.
// Each month-end exit AUM is an anchor on that month's last NIFTY_500
// trading day; between two anchors the AUM compounds NIFTY_500's daily
// return, then a multiplicative ramp (k/N of the month's leftover gap on
// its k-th of N trading days) lands the month exactly on the next anchor.
// The gap is mostly net flows, plus the funds' performance vs the index.

export interface IndexLevel {
  date: string;
  level: number;
}

export interface MonthExitAum {
  /** "YYYY-MM" */
  reportMonth: string;
  exitAumCr: number;
}

export interface MonthAnchor extends MonthExitAum {
  /** The month's last NIFTY_500 trading day. */
  monthEndDate: string;
}

export interface AnchoredDailyAum {
  date: string;
  estimatedAumCr: number;
  /** Before the ramp: the previous anchor × NIFTY_500's move since. */
  rawCompoundedAumCr: number;
  /** The segment's closing anchor date. */
  anchorMonthEndDate: string;
}

export interface SegmentSummary {
  reportMonth: string;
  monthEndDate: string;
  tradingDays: number;
  indexReturn: number;
  aumReturn: number;
  /** Anchor ÷ index-only value − 1: the share the index didn't explain. */
  gapPct: number;
}

function lastDayOfMonth(reportMonth: string): string {
  const [y, m] = reportMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Places each month's exit AUM on that month's last NIFTY_500 trading day
 * (the index rows double as the trading calendar, as resolveMonthEndTradingDate
 * does). Throws when a month has no trading day in the index data.
 */
export function anchorMonths(months: MonthExitAum[], levels: IndexLevel[]): MonthAnchor[] {
  const dates = levels.map((l) => l.date).sort();
  return [...months]
    .sort((a, b) => a.reportMonth.localeCompare(b.reportMonth))
    .map((m) => {
      const end = lastDayOfMonth(m.reportMonth);
      let best: string | null = null;
      for (const d of dates) {
        if (d > end) break;
        if (d.startsWith(m.reportMonth)) best = d;
      }
      if (!best) throw new Error(`No NIFTY_500 trading day in ${m.reportMonth}`);
      return { ...m, monthEndDate: best };
    });
}

/**
 * Daily AUM from the day after the first anchor through the last anchor,
 * plus a per-month summary. Throws if any month's NIFTY_500 rows are
 * missing at either end, rather than writing a partial month.
 */
export function computeAnchoredDailyAum(
  anchors: MonthAnchor[],
  levels: IndexLevel[]
): { rows: AnchoredDailyAum[]; segments: SegmentSummary[] } {
  const sorted = [...levels].sort((a, b) => a.date.localeCompare(b.date));
  const levelOn = new Map(sorted.map((l) => [l.date, l.level]));
  const rows: AnchoredDailyAum[] = [];
  const segments: SegmentSummary[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const start = anchors[i];
    const end = anchors[i + 1];
    const startLevel = levelOn.get(start.monthEndDate);
    const days = sorted.filter((l) => l.date > start.monthEndDate && l.date <= end.monthEndDate);
    if (startLevel === undefined || days.length === 0 || days[days.length - 1].date !== end.monthEndDate) {
      throw new Error(`Missing NIFTY_500 rows for ${start.reportMonth} -> ${end.reportMonth}`);
    }
    const n = days.length;
    const raw = days.map((d) => start.exitAumCr * (d.level / startLevel));
    const scaleFinal = end.exitAumCr / raw[n - 1];
    days.forEach((d, j) => {
      const scale = 1 + (scaleFinal - 1) * ((j + 1) / n);
      rows.push({ date: d.date, estimatedAumCr: raw[j] * scale, rawCompoundedAumCr: raw[j], anchorMonthEndDate: end.monthEndDate });
    });
    segments.push({
      reportMonth: end.reportMonth,
      monthEndDate: end.monthEndDate,
      tradingDays: n,
      indexReturn: days[n - 1].level / startLevel - 1,
      aumReturn: end.exitAumCr / start.exitAumCr - 1,
      gapPct: scaleFinal - 1,
    });
  }
  return { rows, segments };
}
