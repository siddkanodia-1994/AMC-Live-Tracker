import { subtractMonths } from "./date-range";
import { addDaysToDateString } from "../utils/date";
import { getFiscalYearBounds } from "./report-period";

// Maps this app's own amcs.overviewName to the AMC's id in a SEPARATE,
// not-yet-connected Supabase project ("tusk-amc-dashboard loader" -- see
// AMC Score Supabase link/AMC-supabase.txt) that holds a per-AMC composite
// "score" series. Hardcoded rather than auto-matched: the two systems'
// AMC names don't follow one consistent transformation (5 of these 8 drop
// the "Mutual Fund" suffix in Supabase's own naming, 3 don't), so a small,
// explicit, once-reviewed table is safer than a fuzzy-match heuristic. An
// AMC with no entry here simply gets no AMC Score card (see
// getAmcScoreForOverviewName) -- adding a 9th Fortnightly AMC later just
// needs one more row here, nothing else breaks.
const AMC_SCORE_SUPABASE_IDS: Record<string, string> = {
  "HDFC Mutual Fund": "c569d8de-cb98-4828-b5d6-f19fe841636e",
  "Canara Robeco Mutual Fund": "1cddc7b7-958d-473d-bfac-f8d9841192da",
  "Nippon India Mutual Fund": "d4b1f28d-d2a1-4d98-94d5-4e9f6aac4c86",
  "Aditya Birla Sun Life Mutual Fund": "bc2de259-505d-4611-ad75-c568c7cc4b4c",
  "UTI Mutual Fund": "7beeb373-382d-501b-83a5-debac35ededf",
  "SBI Mutual Fund": "edfea58f-42bc-4f93-b9a7-2dd61b5254a3",
  "ICICI Prudential Mutual Fund": "ab6e2830-898a-4c2b-8af9-0269d0748264",
  "Motilal Oswal Mutual Fund": "8f8cc4e5-dc2c-5fa3-8757-0ffbf709ea9f",
};

export interface AmcScoreSnapshot {
  snapshotDate: string;
  score: number | null;
}

// One fetch of this AMC's full Equity-category history -- the category
// this card shows, matching this app's own equity-AUM focus (confirmed
// against the "tusk-amc-dashboard" benchmarking Scores page, which has
// "Equity" selected, not "Overall"/parent_category=null) -- ~100-130 rows
// across 4+ years, small enough that every window/average below is just
// computed in-process rather than pushed into the query. Raw fetch, not
// the supabase-js SDK: PostgREST's own query-string filtering covers
// everything this needs, and the SDK's auth/realtime/storage surface
// would otherwise go entirely unused. Server-side only -- never call this
// from a client component (the key is a service-role secret).
export async function fetchAmcScoreHistory(supabaseAmcId: string): Promise<AmcScoreSnapshot[]> {
  const url = process.env.AMC_SCORE_SUPABASE_URL;
  const key = process.env.AMC_SCORE_SUPABASE_KEY;
  if (!url || !key) return [];

  const endpoint = `${url}/rest/v1/amc_scores?amc_id=eq.${supabaseAmcId}&parent_category=eq.equity&select=snapshot_date,amc_weighted_score&order=snapshot_date.asc`;
  const res = await fetch(endpoint, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) {
    console.error("AMC Score fetch failed:", res.status, await res.text().catch(() => ""));
    return [];
  }
  const rows: { snapshot_date: string; amc_weighted_score: number | null }[] = await res.json();
  return rows.map((r) => ({ snapshotDate: r.snapshot_date, score: r.amc_weighted_score }));
}

export interface AmcScoreRow {
  label: string;
  score: number | null;
  // null = this row IS the reference point (the two "current" rows), not
  // a comparison -- never rendered as "0.00%", always a blank/"--" cell.
  changePct: number | null;
}

export interface AmcScoreCard {
  anchorDate: string;
  rows: AmcScoreRow[];
}

const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthAbbrev(dateStr: string): string {
  return MONTH_ABBREV[Number(dateStr.split("-")[1]) - 1];
}

function fyLabel(dateStr: string): string {
  return `FY${String(getFiscalYearBounds(dateStr).fy).slice(-2)}`;
}

function rangeLabel(startDate: string, endDate: string): string {
  return `${monthAbbrev(startDate)}–${monthAbbrev(endDate)} ${endDate.slice(0, 4)}`;
}

// "30 Sept 26" -- matches the Anchor Date picker's own format
// (fortnightly-update-panel.tsx's formatAnchorDateOption) and the
// "tusk-amc-dashboard" benchmarking Scores page's own date style, for
// every single-date bracket in this card's row labels.
function formatDateLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function isMonthEnd(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  return d === new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function monthEndOf(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

// subtractMonths preserves the source day-of-month (clamped only when the
// target month is too short), so subtracting from a month-end date whose
// own day number is less than 31 (e.g. 30 Sep) lands on that same day
// number in the target month (30 Aug) rather than THAT month's own end
// (31 Aug) -- silently resolving to the wrong snapshot whenever the two
// months have a different length. Re-snapping to month-end only when the
// anchor itself is a month-end keeps a 15th-of-month anchor (which has no
// such ambiguity) untouched.
function subtractMonthsSnapped(dateStr: string, months: number): string {
  const result = subtractMonths(dateStr, months);
  return isMonthEnd(dateStr) ? monthEndOf(result) : result;
}

function avgInRange(history: AmcScoreSnapshot[], start: string, end: string): number | null {
  const sub = history.filter((h) => h.snapshotDate >= start && h.snapshotDate <= end && h.score !== null);
  if (sub.length === 0) return null;
  return sub.reduce((sum, h) => sum + (h.score as number), 0) / sub.length;
}

// The same rolling 6-month window as the card's own "6-Month Avg" row
// (see computeAmcScoreCard), just ending at an arbitrary date instead of
// the anchor -- so "15 Days Ago"/"1 Month Ago"/"1 Year Ago" are each "the
// same 6-Month-Avg metric, evaluated at that date", matching the
// reference dashboard's own chart (every point on its "Score Over Time
// (6M Avg)" line is this same rolling average, never a raw single-day
// score) rather than a point-in-time lookup. Confirmed with the user
// after the raw-lookup version produced a number that didn't match the
// reference chart's own tooltip at that date.
function sixMonthAvgEndingAt(history: AmcScoreSnapshot[], endDate: string): number | null {
  const start = addDaysToDateString(subtractMonths(endDate, 6), 1);
  return avgInRange(history, start, endDate);
}

function pctChange(current: number | null, base: number | null): number | null {
  return current !== null && base !== null && base !== 0 ? current / base - 1 : null;
}

// 6 rows, Period | Score | Change: the two "current" rows (6-Month Avg,
// YTD this FY) carry the reference values; each historical row's Change
// is computed against whichever current row it logically compares to
// (15 Days Ago / 1 Month Ago / 1 Year Ago all compare to the 6-Month Avg;
// YTD Same Period compares to YTD this FY) -- confirmed via preview with
// the user, who wanted the % next to its own row rather than as separate
// trailing rows.
export function computeAmcScoreCard(history: AmcScoreSnapshot[], anchorDate: string): AmcScoreCard | null {
  if (history.length === 0) return null;

  // Matches the "tusk-amc-dashboard" benchmarking Scores page's own "6M
  // Avg" exactly (verified against real HDFC/Equity data: this window
  // averages to 2.6656 -> displays as 2.67, exactly its screenshot value
  // for 30 Sep 2026) -- a plain "minus 6 months, plus a day" day offset,
  // not a whole-calendar-months window. For a 30 Sep anchor that's [31
  // Mar, 30 Sep] (subtractMonths preserves the day-of-month: Sep 30 - 6mo
  // = Mar 30, +1 day = Mar 31), not [1 Apr, 30 Sep] -- an earlier version
  // of this code "fixed" that into a whole-months window on the
  // assumption the extra day was a bug; it wasn't, per the reference
  // dashboard's own convention.
  const sixMoAvg = sixMonthAvgEndingAt(history, anchorDate);

  const fifteenDaysAgo = addDaysToDateString(anchorDate, -15);
  const oneMonthAgo = subtractMonthsSnapped(anchorDate, 1);
  const oneYearAgo = subtractMonthsSnapped(anchorDate, 12);
  const score15d = sixMonthAvgEndingAt(history, fifteenDaysAgo);
  const score1mo = sixMonthAvgEndingAt(history, oneMonthAgo);
  const score1yr = sixMonthAvgEndingAt(history, oneYearAgo);

  const ytdStart = getFiscalYearBounds(anchorDate).start;
  const ytdAvg = avgInRange(history, ytdStart, anchorDate);

  const priorAnchor = subtractMonthsSnapped(anchorDate, 12);
  const priorYtdStart = getFiscalYearBounds(priorAnchor).start;
  const priorYtdAvg = avgInRange(history, priorYtdStart, priorAnchor);

  const rows: AmcScoreRow[] = [
    { label: `6-Month Avg (as of ${formatDateLabel(anchorDate)})`, score: sixMoAvg, changePct: null },
    { label: `15 Days Ago (${formatDateLabel(fifteenDaysAgo)})`, score: score15d, changePct: pctChange(sixMoAvg, score15d) },
    { label: `1 Month Ago (${formatDateLabel(oneMonthAgo)})`, score: score1mo, changePct: pctChange(sixMoAvg, score1mo) },
    { label: `1 Year Ago (${formatDateLabel(oneYearAgo)})`, score: score1yr, changePct: pctChange(sixMoAvg, score1yr) },
    { label: `YTD ${fyLabel(anchorDate)} (${rangeLabel(ytdStart, anchorDate)})`, score: ytdAvg, changePct: null },
    {
      label: `YTD ${fyLabel(priorAnchor)} Same Period (${rangeLabel(priorYtdStart, priorAnchor)})`,
      score: priorYtdAvg,
      changePct: pctChange(ytdAvg, priorYtdAvg),
    },
  ];

  return { anchorDate, rows };
}

export interface AmcScoreResult {
  card: AmcScoreCard | null;
  availableDates: string[]; // descending, for the "Anchor Date" picker
}

// Entry point for getFortnightlySheet: resolves the Supabase id for this
// AMC, fetches its history, and computes the card at the given (or
// latest-available) anchor date. Returns an empty result -- not a thrown
// error -- for any AMC with no mapping or no Supabase rows, so a missing
// mapping degrades to "no card shown" rather than breaking the tab.
export async function getAmcScoreForOverviewName(
  overviewName: string,
  anchorOverride: string | null
): Promise<AmcScoreResult> {
  const supabaseAmcId = AMC_SCORE_SUPABASE_IDS[overviewName];
  if (!supabaseAmcId) return { card: null, availableDates: [] };

  const history = await fetchAmcScoreHistory(supabaseAmcId);
  if (history.length === 0) return { card: null, availableDates: [] };

  const availableDatesAsc = history.map((h) => h.snapshotDate);
  const anchorDate = anchorOverride ?? availableDatesAsc[availableDatesAsc.length - 1];
  const card = computeAmcScoreCard(history, anchorDate);
  return { card, availableDates: [...availableDatesAsc].reverse() };
}
