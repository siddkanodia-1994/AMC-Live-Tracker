import { subtractMonths } from "./date-range";
import { addDaysToDateString } from "../utils/date";
import { closestDateAtOrBefore, getFiscalYearBounds } from "./report-period";

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

// One fetch of this AMC's full history (overall/parent_category=null rows
// only -- the per-category breakdowns aren't used by this card) --
// ~100-130 rows across 4+ years, small enough that every window/average
// below is just computed in-process rather than pushed into the query.
// Raw fetch, not the supabase-js SDK: PostgREST's own query-string
// filtering covers everything this needs, and the SDK's auth/realtime/
// storage surface would otherwise go entirely unused. Server-side only --
// never call this from a client component (the key is a service-role
// secret).
export async function fetchAmcScoreHistory(supabaseAmcId: string): Promise<AmcScoreSnapshot[]> {
  const url = process.env.AMC_SCORE_SUPABASE_URL;
  const key = process.env.AMC_SCORE_SUPABASE_KEY;
  if (!url || !key) return [];

  const endpoint = `${url}/rest/v1/amc_scores?amc_id=eq.${supabaseAmcId}&parent_category=is.null&select=snapshot_date,amc_weighted_score&order=snapshot_date.asc`;
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

function firstDayOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
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

// Closest real snapshot at/before `target` -- so an older anchor date
// (pre-May-2026, when amc_scores only had month-end rows, no 15th) still
// resolves a sensible "15 days ago"/"1 month ago" figure instead of null.
// Returns the snapshot it actually resolved to (not `target` itself) so
// the row label can show the real date the score came from whenever that
// differs from the naive target -- otherwise a label like "1 Year Ago
// (2025-09-15)" would misleadingly imply data exists exactly on that day
// when it was really pulled from a snapshot weeks earlier.
function scoreAt(history: AmcScoreSnapshot[], target: string): { date: string | null; score: number | null } {
  const closest = closestDateAtOrBefore(
    history.map((h) => h.snapshotDate),
    target
  );
  if (closest === null) return { date: null, score: null };
  return { date: closest, score: history.find((h) => h.snapshotDate === closest)?.score ?? null };
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

  // Whole calendar months, not an exact "minus 6 months" day offset: for
  // anchor 30 Sep, that's [1 Apr, 30 Sep] (6 full months), not [31 Mar, 30
  // Sep] -- day-of-month subtraction alone would have snapped to 30 Mar
  // (day preserved) and then off-by-one into including 31 Mar's own
  // snapshot. This also means the window matches the FYTD window exactly
  // when the anchor sits 6 months into its fiscal year (e.g. 30 Sep),
  // which is intentional, not a bug (see the preview's own note on this).
  const sixMoWindowStart = firstDayOfMonth(subtractMonths(anchorDate, 5));
  const sixMoAvg = avgInRange(history, sixMoWindowStart, anchorDate);

  const fifteenDaysAgo = addDaysToDateString(anchorDate, -15);
  const oneMonthAgo = subtractMonthsSnapped(anchorDate, 1);
  const oneYearAgo = subtractMonthsSnapped(anchorDate, 12);
  const score15d = scoreAt(history, fifteenDaysAgo);
  const score1mo = scoreAt(history, oneMonthAgo);
  const score1yr = scoreAt(history, oneYearAgo);

  const ytdStart = getFiscalYearBounds(anchorDate).start;
  const ytdAvg = avgInRange(history, ytdStart, anchorDate);

  const priorAnchor = subtractMonthsSnapped(anchorDate, 12);
  const priorYtdStart = getFiscalYearBounds(priorAnchor).start;
  const priorYtdAvg = avgInRange(history, priorYtdStart, priorAnchor);

  const rows: AmcScoreRow[] = [
    { label: `6-Month Avg (as of ${anchorDate})`, score: sixMoAvg, changePct: null },
    { label: `15 Days Ago${score15d.date ? ` (${score15d.date})` : ""}`, score: score15d.score, changePct: pctChange(sixMoAvg, score15d.score) },
    { label: `1 Month Ago${score1mo.date ? ` (${score1mo.date})` : ""}`, score: score1mo.score, changePct: pctChange(sixMoAvg, score1mo.score) },
    { label: `1 Year Ago${score1yr.date ? ` (${score1yr.date})` : ""}`, score: score1yr.score, changePct: pctChange(sixMoAvg, score1yr.score) },
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
