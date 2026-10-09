import { subtractMonths } from "./date-range";
import type { AumHistoryPoint } from "./history";
import {
  getFiscalQuarterBounds,
  getFiscalYearAndQuarter,
  getFiscalYearBounds,
  getPreviousFiscalQuarterBounds,
  getPreviousFiscalYearBounds,
} from "./report-period";
import { trimToLastContinuousRun } from "./series-math";

export type AumMode = "average" | "exit";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

// undefined = this column is structurally not shown on this row (blank
// cell); null = the column applies here but there isn't enough history yet
// ("--"); a number = a real computed value.
export interface FinancialYearRow {
  label: string;
  valCr: number | null;
  yoyPct?: number | null;
  range: [string, string];
}

export interface QuarterRow {
  label: string;
  valCr: number | null;
  qoqPct?: number | null;
  yoyPct?: number | null;
  range: [string, string];
}

export interface MonthRow {
  label: string;
  valCr: number | null;
  momPct?: number | null;
  mo6mPct?: number | null;
  range?: [string, string];
}

export interface TradingWindowRow {
  label: string;
  valCr: number | null;
  wowPct?: number | null;
  wo10wPct?: number | null;
  range: [string | null, string | null];
}

export interface WeekdaySection {
  weekday: string;
  top: { valCr: number | null; do3dPct: number | null; do10dPct: number | null };
  avg3Cr: number | null;
  avg10Cr: number | null;
}

export interface SummaryViewData {
  financialYear: FinancialYearRow[];
  quarter: QuarterRow[];
  month: MonthRow[];
  tradingWindow: TradingWindowRow[];
  weekdays: WeekdaySection[];
}

function monthBounds(dateStr: string): { start: string; end: string } {
  const [year, month] = dateStr.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function fyOfMonthStart(startDate: string): number {
  const [year, month] = startDate.split("-").map(Number);
  return month >= 4 ? year + 1 : year;
}

// Mean (mode="average") or last-point (mode="exit") liveAumCr over
// [startDate, endDate] inclusive -- the one primitive every block below
// composes from. null if zero points fall in range.
export function averageOrExitAum(
  points: AumHistoryPoint[],
  startDate: string,
  endDate: string,
  mode: AumMode
): number | null {
  const sub = points.filter((p) => p.date >= startDate && p.date <= endDate);
  if (sub.length === 0) return null;
  if (mode === "exit") return sub[sub.length - 1].liveAumCr;
  return sub.reduce((sum, p) => sum + p.liveAumCr, 0) / sub.length;
}

export function pctChange(current: number | null, base: number | null): number | null {
  if (current === null || base === null || base === 0) return null;
  return current / base - 1;
}

// Steps back `n` Indian fiscal quarters from whichever quarter `dateStr`
// falls in -- n=4 lands on "the same calendar quarter, one fiscal year
// earlier" (NOT n=3, which lands one quarter short of a true YoY match).
export function nFiscalQuartersBack(dateStr: string, n: number): { start: string; end: string } {
  let bounds = getFiscalQuarterBounds(dateStr);
  for (let i = 0; i < n; i++) bounds = getPreviousFiscalQuarterBounds(bounds.start);
  return bounds;
}

// Trailing trading-day window, offset by `offsetWindows` full windows back
// (0 = the most recent `windowSize` points up to `today`; 1 = the
// `windowSize` points immediately before that, non-overlapping; etc.) --
// mirrors computeMovingAverage's own trailing-window idea, but as an
// explicit array-index slice since AumHistoryPoint rows are already
// one-per-trading-day (see trimToLastContinuousRun below). Strict: null
// unless the full window size is actually available -- never a
// shrunk/partial window.
export function getTradingDayWindow(
  points: AumHistoryPoint[],
  today: string,
  windowSize: number,
  offsetWindows: number,
  mode: AumMode
): { valueCr: number | null; windowStart: string | null; windowEnd: string | null } {
  const eligible = points.filter((p) => p.date <= today);
  const endIdx = eligible.length - offsetWindows * windowSize;
  const startIdx = endIdx - windowSize;
  if (startIdx < 0 || endIdx <= 0 || endIdx > eligible.length) {
    return { valueCr: null, windowStart: null, windowEnd: null };
  }
  const window = eligible.slice(startIdx, endIdx);
  const value =
    mode === "exit"
      ? window[window.length - 1].liveAumCr
      : window.reduce((sum, p) => sum + p.liveAumCr, 0) / window.length;
  return { valueCr: value, windowStart: window[0].date, windowEnd: window[window.length - 1].date };
}

// The `count` most recent dates <= today matching `weekdayIndex` (Date's
// own getUTCDay(): 1=Monday..5=Friday, matched via a UTC midnight parse so
// there's no local-timezone drift). Returns fewer than `count` if history
// doesn't reach back far enough -- callers decide the null-vs-partial
// policy (see buildWeekdaySection: strict, same philosophy as
// getTradingDayWindow).
export function getWeekdayOccurrences(
  points: AumHistoryPoint[],
  today: string,
  weekdayIndex: number,
  count: number
): AumHistoryPoint[] {
  const eligible = points.filter(
    (p) => p.date <= today && new Date(`${p.date}T00:00:00Z`).getUTCDay() === weekdayIndex
  );
  return eligible.length >= count ? eligible.slice(-count) : eligible;
}

function clampToToday(end: string, today: string): string {
  return end < today ? end : today;
}

function buildFinancialYearBlock(points: AumHistoryPoint[], today: string, mode: AumMode): FinancialYearRow[] {
  const cur = getFiscalYearBounds(today);
  const prev = getPreviousFiscalYearBounds(today);
  const curEnd = clampToToday(cur.end, today);
  const v0 = averageOrExitAum(points, cur.start, curEnd, mode);
  const v1 = averageOrExitAum(points, prev.start, prev.end, mode);
  return [
    { label: `FY ${cur.fy}`, valCr: v0, yoyPct: pctChange(v0, v1), range: [cur.start, curEnd] },
    { label: `FY ${prev.fy}`, valCr: v1, range: [prev.start, prev.end] },
  ];
}

// 5 rows: current quarter to date, prior quarter, prior-prior quarter
// (context only), and the two most recent quarters' OWN YoY anchors (same
// calendar quarter, one fiscal year earlier) -- both the current and prior
// quarter get their own QoQ + YoY.
function buildQuarterBlock(points: AumHistoryPoint[], today: string, mode: AumMode): QuarterRow[] {
  const q0 = getFiscalQuarterBounds(today);
  const q1 = getPreviousFiscalQuarterBounds(q0.start);
  const q2 = getPreviousFiscalQuarterBounds(q1.start);
  const yoy0 = nFiscalQuartersBack(today, 4);
  const yoy1 = nFiscalQuartersBack(q1.start, 4);
  const q0End = clampToToday(q0.end, today);

  const v0 = averageOrExitAum(points, q0.start, q0End, mode);
  const v1 = averageOrExitAum(points, q1.start, q1.end, mode);
  const v2 = averageOrExitAum(points, q2.start, q2.end, mode);
  const vY0 = averageOrExitAum(points, yoy0.start, yoy0.end, mode);
  const vY1 = averageOrExitAum(points, yoy1.start, yoy1.end, mode);

  const label = (b: { start: string }) => {
    const { fy, q } = getFiscalYearAndQuarter(b.start);
    return `Q${q} FY ${fy}`;
  };

  return [
    { label: label(q0), valCr: v0, qoqPct: pctChange(v0, v1), yoyPct: pctChange(v0, vY0), range: [q0.start, q0End] },
    { label: label(q1), valCr: v1, qoqPct: pctChange(v1, v2), yoyPct: pctChange(v1, vY1), range: [q1.start, q1.end] },
    { label: label(q2), valCr: v2, range: [q2.start, q2.end] },
    { label: label(yoy0), valCr: vY0, range: [yoy0.start, yoy0.end] },
    { label: label(yoy1), valCr: vY1, range: [yoy1.start, yoy1.end] },
  ];
}

// 4 rows: current month to date, prior month, 2-months-back (context only,
// needed as prior month's own MoM comparator), and a single shared "Avg Of
// Last 6 Months" row (the 6 fully-elapsed months at offsets 1-6 back from
// today, excluding the current partial month) -- both the current and
// prior month compare their own Mo 6M against this SAME shared row.
function buildMonthBlock(points: AumHistoryPoint[], today: string, mode: AumMode): MonthRow[] {
  const cur = monthBounds(today);
  const curEnd = clampToToday(cur.end, today);
  const prevB = monthBounds(subtractMonths(today, 1));
  const twoBackB = monthBounds(subtractMonths(today, 2));

  const v0 = averageOrExitAum(points, cur.start, curEnd, mode);
  const v1 = averageOrExitAum(points, prevB.start, prevB.end, mode);
  const v2 = averageOrExitAum(points, twoBackB.start, twoBackB.end, mode);

  let sixMonthsComplete = true;
  const sixVals: number[] = [];
  let sixStart = "";
  let sixEnd = "";
  for (let off = 6; off >= 1; off--) {
    const b = monthBounds(subtractMonths(today, off));
    if (off === 6) sixStart = b.start;
    if (off === 1) sixEnd = b.end;
    const v = averageOrExitAum(points, b.start, b.end, mode);
    if (v === null) sixMonthsComplete = false;
    else sixVals.push(v);
  }
  const v3 = sixMonthsComplete ? sixVals.reduce((s, x) => s + x, 0) / 6 : null;

  const label = (b: { start: string }) => {
    const month = Number(b.start.split("-")[1]);
    return `FY ${fyOfMonthStart(b.start)} ${MONTH_NAMES[month - 1]}`;
  };

  return [
    {
      label: label(cur), valCr: v0, momPct: pctChange(v0, v1), mo6mPct: pctChange(v0, v3),
      range: [cur.start, curEnd],
    },
    {
      label: label(prevB), valCr: v1, momPct: pctChange(v1, v2), mo6mPct: pctChange(v1, v3),
      range: [prevB.start, prevB.end],
    },
    { label: label(twoBackB), valCr: v2, range: [twoBackB.start, twoBackB.end] },
    { label: "Avg Of Last 6 Months", valCr: v3, range: [sixStart, sixEnd] },
  ];
}

// 5 rows: Last 5 Trading Days, Previous 5 Trading Days, 2nd Previous 5
// Trading Days (context only, needed as Previous 5TD's own WoW
// comparator), Last 45 Trading Days (shared Wo 10W reference for BOTH of
// the two most recent windows), Last 20 Trading Days (no comparator, same
// as the original reference layout).
function buildTradingWindowBlock(points: AumHistoryPoint[], today: string, mode: AumMode): TradingWindowRow[] {
  const r0 = getTradingDayWindow(points, today, 5, 0, mode);
  const r1 = getTradingDayWindow(points, today, 5, 1, mode);
  const r2 = getTradingDayWindow(points, today, 5, 2, mode);
  const r45 = getTradingDayWindow(points, today, 45, 0, mode);
  const r20 = getTradingDayWindow(points, today, 20, 0, mode);

  return [
    {
      label: "Last 5 Trading Days", valCr: r0.valueCr,
      wowPct: pctChange(r0.valueCr, r1.valueCr), wo10wPct: pctChange(r0.valueCr, r45.valueCr),
      range: [r0.windowStart, r0.windowEnd],
    },
    {
      label: "Previous 5 Trading Days", valCr: r1.valueCr,
      wowPct: pctChange(r1.valueCr, r2.valueCr), wo10wPct: pctChange(r1.valueCr, r45.valueCr),
      range: [r1.windowStart, r1.windowEnd],
    },
    { label: "2nd Previous 5 Trading Days", valCr: r2.valueCr, range: [r2.windowStart, r2.windowEnd] },
    { label: "Last 45 Trading Days", valCr: r45.valueCr, range: [r45.windowStart, r45.windowEnd] },
    { label: "Last 20 Trading Days", valCr: r20.valueCr, range: [r20.windowStart, r20.windowEnd] },
  ];
}

// Top row = that weekday's own most recent occurrence's Live AUM
// (mode-invariant by construction -- a single day's average and exit are
// the same number, so this is computed via the same averageOrExitAum
// primitive rather than special-cased). The two sub-rows average that
// weekday's own value across its last 3/10 occurrences, INCLUSIVE of the
// latest one -- a trailing window, not "the N before the most recent."
function buildWeekdaySection(
  points: AumHistoryPoint[],
  today: string,
  weekdayIndex: number,
  weekdayName: string,
  mode: AumMode
): WeekdaySection {
  const occ10 = getWeekdayOccurrences(points, today, weekdayIndex, 10);
  const occ3 = occ10.slice(-3);
  const latest = occ10.length > 0 ? occ10[occ10.length - 1] : null;
  const topVal = latest ? averageOrExitAum(points, latest.date, latest.date, mode) : null;
  const avg3 = occ3.length === 3 ? occ3.reduce((s, p) => s + p.liveAumCr, 0) / 3 : null;
  const avg10 = occ10.length === 10 ? occ10.reduce((s, p) => s + p.liveAumCr, 0) / 10 : null;
  return {
    weekday: weekdayName,
    top: { valCr: topVal, do3dPct: pctChange(topVal, avg3), do10dPct: pctChange(topVal, avg10) },
    avg3Cr: avg3,
    avg10Cr: avg10,
  };
}

export function computeSummaryViewData(
  aumHistory: AumHistoryPoint[],
  mode: AumMode,
  today: string
): SummaryViewData {
  const points = trimToLastContinuousRun(aumHistory);
  return {
    financialYear: buildFinancialYearBlock(points, today, mode),
    quarter: buildQuarterBlock(points, today, mode),
    month: buildMonthBlock(points, today, mode),
    tradingWindow: buildTradingWindowBlock(points, today, mode),
    weekdays: WEEKDAY_NAMES.map((name, i) => buildWeekdaySection(points, today, i + 1, name, mode)),
  };
}
