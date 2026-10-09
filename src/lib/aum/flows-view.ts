import type { MonthlyFlowPoint } from "./industry-flows";
import { pctChange, nFiscalQuartersBack } from "./summary-view";
import {
  getFiscalQuarterBounds,
  getFiscalYearAndQuarter,
  getFiscalYearBounds,
  getPreviousFiscalQuarterBounds,
  getPreviousFiscalYearBounds,
} from "./report-period";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type FlowMetricKey = "sipContributionsCr" | "equityNetFlowsCr" | "equityBulkFlowsCr";

// Same undefined/null/number convention as summary-view.ts: undefined =
// structurally absent on this row (blank cell), null = applies but no data
// ("--"), number = a real value. `estimated` flags a row whose total
// includes the one rolling placeholder month (see computeFlowsViewData) --
// never set on a row built entirely from real, entered data.
//
// `chg1`/`chg2` are deliberately generic (not named "Qoq"/"Yoy") -- each
// block gives them its own real meaning via its own banner header
// (QoQ/YoY for the Quarter block, YoY/"vs Avg 6M" for the Month block, just
// YoY in `chg2` for the Financial Year block) rather than the field name
// itself, since the same two slots mean different things per block.
export interface FlowPeriodRow {
  label: string;
  range: [string, string];
  estimated?: boolean;
  sip: number | null;
  sipChg1?: number | null;
  sipChg2?: number | null;
  netFlow: number | null;
  netFlowChg1?: number | null;
  netFlowChg2?: number | null;
  bulk: number | null;
  bulkChg1?: number | null;
  bulkChg2?: number | null;
}

export interface FlowsViewData {
  financialYear: FlowPeriodRow[];
  quarter: FlowPeriodRow[];
  month: FlowPeriodRow[];
  // The latest REAL (entered) month, and the one synthetic month rolled
  // forward from it -- surfaced so the UI can caption what's real vs
  // estimated without re-deriving it.
  latestRealMonth: string | null;
  estimatedMonth: string | null;
}

const EMPTY_VIEW: FlowsViewData = { financialYear: [], quarter: [], month: [], latestRealMonth: null, estimatedMonth: null };

// Local copies of small pure date helpers also used by summary-view.ts --
// duplicated rather than extracted/shared, to avoid touching already-
// verified AUM code for this unrelated feature (see this round's plan).
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
function clampToAnchor(end: string, anchorDate: string): string {
  return end < anchorDate ? end : anchorDate;
}
// Pure year/month arithmetic (not JS Date month-rollover) -- same fix as
// date-range.ts's subtractMonths, duplicated locally per this round's plan.
// A negative `months` adds months instead of subtracting.
function subtractMonthsLocal(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const totalMonths = y * 12 + (m - 1) - months;
  const newY = Math.floor(totalMonths / 12);
  const newM0 = ((totalMonths % 12) + 12) % 12;
  const lastDayOfNewMonth = new Date(Date.UTC(newY, newM0 + 1, 0)).getUTCDate();
  const newD = Math.min(d, lastDayOfNewMonth);
  return `${newY}-${String(newM0 + 1).padStart(2, "0")}-${String(newD).padStart(2, "0")}`;
}

// Sum of whatever monthly rows fall in [start, end] inclusive -- the flows
// analog of summary-view.ts's averageOrExitAum, except these 3 metrics are
// always summed within a period (confirmed: flows, not AUM levels, have no
// "average vs exit" concept).
function sumInRange(points: MonthlyFlowPoint[], start: string, end: string, key: FlowMetricKey): number | null {
  const sub = points.filter((p) => p.monthEndDate >= start && p.monthEndDate <= end);
  if (sub.length === 0) return null;
  return sub.reduce((s, p) => s + p[key], 0);
}

function sumsFor(points: MonthlyFlowPoint[], start: string, end: string) {
  return {
    sip: sumInRange(points, start, end, "sipContributionsCr"),
    netFlow: sumInRange(points, start, end, "equityNetFlowsCr"),
    bulk: sumInRange(points, start, end, "equityBulkFlowsCr"),
  };
}

// 3 rows, built from REAL data only (the rolling placeholder month never
// contributes to an FY total -- even with it, FY2027 YTD is nowhere near a
// full year, so blending it in wouldn't make the period "complete" the way
// it does for Month/Quarter). Instead, when the current FY is a partial
// year (every "current FY" row always is, by construction), a middle row
// shows the SAME real months one fiscal year earlier -- an apples-to-apples
// YoY base -- confirmed by the user after the naive version (comparing a
// 5-month YTD sum against the full prior year) produced a structurally
// guaranteed, meaningless negative YoY%.
function buildFinancialYearBlock(realPoints: MonthlyFlowPoint[], latestReal: string): FlowPeriodRow[] {
  const cur = getFiscalYearBounds(latestReal);
  const prev = getPreviousFiscalYearBounds(latestReal);
  const prevPrev = getPreviousFiscalYearBounds(prev.start);
  const curEnd = clampToAnchor(cur.end, latestReal);
  const v0 = sumsFor(realPoints, cur.start, curEnd);
  const v1Full = sumsFor(realPoints, prev.start, prev.end);
  const v2Full = sumsFor(realPoints, prevPrev.start, prevPrev.end);

  const samePeriodStart = subtractMonthsLocal(cur.start, 12);
  const samePeriodEnd = subtractMonthsLocal(curEnd, 12);
  const v1Same = sumsFor(realPoints, samePeriodStart, samePeriodEnd);

  return [
    {
      label: `FY ${cur.fy}`, range: [cur.start, curEnd],
      sip: v0.sip, sipChg2: pctChange(v0.sip, v1Same.sip),
      netFlow: v0.netFlow, netFlowChg2: pctChange(v0.netFlow, v1Same.netFlow),
      bulk: v0.bulk, bulkChg2: pctChange(v0.bulk, v1Same.bulk),
    },
    {
      label: `FY ${prev.fy} (Same Period)`, range: [samePeriodStart, samePeriodEnd],
      sip: v1Same.sip, netFlow: v1Same.netFlow, bulk: v1Same.bulk,
    },
    {
      label: `FY ${prev.fy}`, range: [prev.start, prev.end],
      sip: v1Full.sip, sipChg2: pctChange(v1Full.sip, v2Full.sip),
      netFlow: v1Full.netFlow, netFlowChg2: pctChange(v1Full.netFlow, v2Full.netFlow),
      bulk: v1Full.bulk, bulkChg2: pctChange(v1Full.bulk, v2Full.bulk),
    },
  ];
}

// Same 5-row shape as summary-view.ts's buildQuarterBlock, computed over
// REAL + the one rolling placeholder month (`points`/`anchor` already
// include it -- see computeFlowsViewData). Unlike the FY block, a quarter
// is short enough that the single placeholder month reliably completes it
// (2 real months + 1 estimated = a normal 3-month quarter), so QoQ/YoY
// here compare like-for-like full quarters without needing an extra row.
function buildQuarterBlock(points: MonthlyFlowPoint[], anchor: string, estimatedMonth: string | null): FlowPeriodRow[] {
  const q0 = getFiscalQuarterBounds(anchor);
  const q1 = getPreviousFiscalQuarterBounds(q0.start);
  const q2 = getPreviousFiscalQuarterBounds(q1.start);
  const yoy0 = nFiscalQuartersBack(anchor, 4);
  const yoy1 = nFiscalQuartersBack(q1.start, 4);
  const q0End = clampToAnchor(q0.end, anchor);
  const q0Estimated = estimatedMonth !== null && estimatedMonth >= q0.start && estimatedMonth <= q0End;

  const v0 = sumsFor(points, q0.start, q0End);
  const v1 = sumsFor(points, q1.start, q1.end);
  const v2 = sumsFor(points, q2.start, q2.end);
  const vY0 = sumsFor(points, yoy0.start, yoy0.end);
  const vY1 = sumsFor(points, yoy1.start, yoy1.end);

  const label = (b: { start: string }) => {
    const { fy, q } = getFiscalYearAndQuarter(b.start);
    return `Q${q} FY ${fy}`;
  };

  return [
    {
      label: label(q0), range: [q0.start, q0End], estimated: q0Estimated,
      sip: v0.sip, sipChg1: pctChange(v0.sip, v1.sip), sipChg2: pctChange(v0.sip, vY0.sip),
      netFlow: v0.netFlow, netFlowChg1: pctChange(v0.netFlow, v1.netFlow), netFlowChg2: pctChange(v0.netFlow, vY0.netFlow),
      bulk: v0.bulk, bulkChg1: pctChange(v0.bulk, v1.bulk), bulkChg2: pctChange(v0.bulk, vY0.bulk),
    },
    {
      label: label(q1), range: [q1.start, q1.end],
      sip: v1.sip, sipChg1: pctChange(v1.sip, v2.sip), sipChg2: pctChange(v1.sip, vY1.sip),
      netFlow: v1.netFlow, netFlowChg1: pctChange(v1.netFlow, v2.netFlow), netFlowChg2: pctChange(v1.netFlow, vY1.netFlow),
      bulk: v1.bulk, bulkChg1: pctChange(v1.bulk, v2.bulk), bulkChg2: pctChange(v1.bulk, vY1.bulk),
    },
    { label: label(q2), range: [q2.start, q2.end], sip: v2.sip, netFlow: v2.netFlow, bulk: v2.bulk },
    { label: label(yoy0), range: [yoy0.start, yoy0.end], sip: vY0.sip, netFlow: vY0.netFlow, bulk: vY0.bulk },
    { label: label(yoy1), range: [yoy1.start, yoy1.end], sip: vY1.sip, netFlow: vY1.netFlow, bulk: vY1.bulk },
  ];
}

// 5 rows, computed over REAL + the one rolling placeholder month: current
// month, prior month (both get their own YoY, vs. the same calendar month
// one year back -- rows 3/4 below -- plus "vs Avg 6M"), then the two YoY
// base months as their own visible rows (context only, same convention as
// buildQuarterBlock's own YoY-anchor rows), then the 6-month average.
// Confirmed design: no more MoM / no more "2-back month" context row --
// once the comparison is YoY instead of month-over-month, the 2-back month
// has no remaining purpose. "Average Of Last 6 Months" stays an AVERAGE
// (not a sum) because it's a comparison BASELINE for a single month, not a
// period total -- comparing one month's sum against a 6-month sum would be
// apples-to-oranges (confirmed in an earlier round, which showed
// nonsensical -80%+ swings before this fix); that 6-month window is always
// built from real months only (off 1-6 relative to the anchor never
// reaches the placeholder, which sits exactly at off 0).
function buildMonthBlock(points: MonthlyFlowPoint[], anchor: string, estimatedMonth: string | null): FlowPeriodRow[] {
  const cur = monthBounds(anchor);
  const prevB = monthBounds(subtractMonthsLocal(anchor, 1));
  const yoy0B = monthBounds(subtractMonthsLocal(anchor, 12));
  const yoy1B = monthBounds(subtractMonthsLocal(anchor, 13));
  const curEstimated = estimatedMonth !== null && estimatedMonth >= cur.start && estimatedMonth <= cur.end;

  const v0 = sumsFor(points, cur.start, cur.end);
  const v1 = sumsFor(points, prevB.start, prevB.end);
  const vYoy0 = sumsFor(points, yoy0B.start, yoy0B.end);
  const vYoy1 = sumsFor(points, yoy1B.start, yoy1B.end);

  let sixComplete = true;
  const sixVals: ReturnType<typeof sumsFor>[] = [];
  let sixStart = "";
  let sixEnd = "";
  for (let off = 6; off >= 1; off--) {
    const b = monthBounds(subtractMonthsLocal(anchor, off));
    if (off === 6) sixStart = b.start;
    if (off === 1) sixEnd = b.end;
    const v = sumsFor(points, b.start, b.end);
    if (v.sip === null || v.netFlow === null || v.bulk === null) sixComplete = false;
    else sixVals.push(v);
  }
  const avg6 = sixComplete
    ? {
        sip: sixVals.reduce((s, v) => s + (v.sip as number), 0) / 6,
        netFlow: sixVals.reduce((s, v) => s + (v.netFlow as number), 0) / 6,
        bulk: sixVals.reduce((s, v) => s + (v.bulk as number), 0) / 6,
      }
    : { sip: null, netFlow: null, bulk: null };

  const label = (b: { start: string }) => {
    const month = Number(b.start.split("-")[1]);
    return `FY ${fyOfMonthStart(b.start)} ${MONTH_NAMES[month - 1]}`;
  };

  return [
    {
      label: label(cur), range: [cur.start, cur.end], estimated: curEstimated,
      sip: v0.sip, sipChg1: pctChange(v0.sip, vYoy0.sip), sipChg2: pctChange(v0.sip, avg6.sip),
      netFlow: v0.netFlow, netFlowChg1: pctChange(v0.netFlow, vYoy0.netFlow), netFlowChg2: pctChange(v0.netFlow, avg6.netFlow),
      bulk: v0.bulk, bulkChg1: pctChange(v0.bulk, vYoy0.bulk), bulkChg2: pctChange(v0.bulk, avg6.bulk),
    },
    {
      label: label(prevB), range: [prevB.start, prevB.end],
      sip: v1.sip, sipChg1: pctChange(v1.sip, vYoy1.sip), sipChg2: pctChange(v1.sip, avg6.sip),
      netFlow: v1.netFlow, netFlowChg1: pctChange(v1.netFlow, vYoy1.netFlow), netFlowChg2: pctChange(v1.netFlow, avg6.netFlow),
      bulk: v1.bulk, bulkChg1: pctChange(v1.bulk, vYoy1.bulk), bulkChg2: pctChange(v1.bulk, avg6.bulk),
    },
    { label: label(yoy0B), range: [yoy0B.start, yoy0B.end], sip: vYoy0.sip, netFlow: vYoy0.netFlow, bulk: vYoy0.bulk },
    { label: label(yoy1B), range: [yoy1B.start, yoy1B.end], sip: vYoy1.sip, netFlow: vYoy1.netFlow, bulk: vYoy1.bulk },
    { label: "Average Of Last 6 Months", range: [sixStart, sixEnd], sip: avg6.sip, netFlow: avg6.netFlow, bulk: avg6.bulk },
  ];
}

// Entry point. Takes REAL (entered) monthly points only -- no external
// "today"/anchor parameter, since the whole point of this function is that
// "current" is derived from the data, not the live clock (AMFI publishes
// with a lag; confirmed design decision).
//
// Internally rolls forward exactly ONE synthetic placeholder month, equal
// to the latest real month's own figures, so the Month/Quarter blocks'
// "current" row always reflects "this is what we'd expect, absent a new
// number yet" instead of getting stuck re-showing last month as current
// indefinitely. Confirmed by the user: never more than one placeholder
// month, regardless of how far behind data entry gets -- replaced the
// instant the real number is added via the Admin form, at which point the
// next call to this function rolls the placeholder forward by one more
// month automatically (it's always derived, never stored).
export function computeFlowsViewData(realPoints: MonthlyFlowPoint[]): FlowsViewData {
  if (realPoints.length === 0) return EMPTY_VIEW;
  const sorted = [...realPoints].sort((a, b) => (a.monthEndDate < b.monthEndDate ? -1 : 1));
  const latestReal = sorted[sorted.length - 1];
  const estimatedMonth = monthBounds(subtractMonthsLocal(latestReal.monthEndDate, -1)).end;
  const withPlaceholder: MonthlyFlowPoint[] = [
    ...sorted,
    {
      monthEndDate: estimatedMonth,
      sipContributionsCr: latestReal.sipContributionsCr,
      equityNetFlowsCr: latestReal.equityNetFlowsCr,
      equityBulkFlowsCr: latestReal.equityBulkFlowsCr,
    },
  ];

  return {
    financialYear: buildFinancialYearBlock(sorted, latestReal.monthEndDate),
    quarter: buildQuarterBlock(withPlaceholder, estimatedMonth, estimatedMonth),
    month: buildMonthBlock(withPlaceholder, estimatedMonth, estimatedMonth),
    latestRealMonth: latestReal.monthEndDate,
    estimatedMonth,
  };
}
