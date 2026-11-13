// Industry and AMC SIP card plumbing shared by the Fortnightly AMC Update
// tab and AMC Analytics' SIP & Score: the cards' period labels, the global
// industry anchor / estimate settings (app_settings) and the AMFI-derived
// industry figures. Moved out of fortnightly-update.ts unchanged, so either
// tab can go without the other.

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings } from "../db/schema";
import { subtractMonths } from "./date-range";
import { getAllMonthlyFlows, type MonthlyFlowPoint } from "./industry-flows";
import { getFiscalQuarterBounds, getPreviousFiscalQuarterBounds, getFiscalYearAndQuarter } from "./report-period";

// ---------------------------------------------------------------------
// SIP section period labels (values are manual; only the labels + date
// ranges are derived, using the SAME fiscal-quarter scheme as QAAUM for
// AMC growth, and a plain calendar-month step for Industry growth).
// ---------------------------------------------------------------------

export interface SipPeriodLabels {
  qtd: string;
  prevQ: string;
  prevQ2: string;
  yoyQ: string;
  yoyQ2: string;
}

// Inverse of getFiscalYearAndQuarter -- the first calendar day of a given
// (fy, quarter) Indian fiscal quarter, so the existing date-based
// getPreviousFiscalQuarterBounds/getFiscalYearAndQuarter helpers can step
// backward from a manually-picked quarter exactly the way they already
// step backward from asOfDate.
function fiscalQuarterAnchorDate(fy: number, quarter: number): string {
  if (quarter === 1) return `${fy - 1}-04-01`;
  if (quarter === 2) return `${fy - 1}-07-01`;
  if (quarter === 3) return `${fy - 1}-10-01`;
  return `${fy}-01-01`; // Q4, Jan-Mar
}

// Takes the "latest available quarter" as an explicit (fy, quarter) anchor
// rather than asOfDate -- there's no live per-AMC SIP data source to
// auto-derive it from (unlike SIP Industry Growth's industry_monthly_flow),
// so the analyst picks it directly (see sipAmcLatestFy/sipAmcLatestQuarter
// on getFortnightlySheet's returned sheet).
export function getSipAmcPeriodLabels(anchorFy: number, anchorQuarter: number): SipPeriodLabels {
  const anchorDate = fiscalQuarterAnchorDate(anchorFy, anchorQuarter);
  const prevQBounds = getPreviousFiscalQuarterBounds(anchorDate);
  const prevQ = getFiscalYearAndQuarter(prevQBounds.start);
  const prevQ2Bounds = getPreviousFiscalQuarterBounds(prevQBounds.start);
  const prevQ2 = getFiscalYearAndQuarter(prevQ2Bounds.start);
  const label = (fy: number, q: number) => `Q${q}FY${String(fy).slice(-2)}`;
  return {
    qtd: label(anchorFy, anchorQuarter),
    prevQ: label(prevQ.fy, prevQ.q),
    prevQ2: label(prevQ2.fy, prevQ2.q),
    yoyQ: label(anchorFy - 1, anchorQuarter),
    yoyQ2: label(prevQ.fy - 1, prevQ.q),
  };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(year: number, month0: number): string {
  return `${MONTH_NAMES[month0]} ${year}`;
}

function monthEndToLabel(monthEndDate: string): string {
  const [y, m] = monthEndDate.split("-").map(Number);
  return monthLabel(y, m - 1);
}

// Re-snaps a date to ITS OWN month's last day. subtractMonths preserves the
// source day-of-month (clamped), so chaining it across months of different
// lengths drifts off month-end (e.g. Sep 30 minus 1 month lands on Aug 30,
// not Aug 31) -- wrapping every step in this fixes that, matching
// flows-view.ts's own `monthBounds(subtractMonthsLocal(...)).end` pattern.
function monthEndOf(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export interface SipIndustryValues {
  mtd: number | null;
  prevM: number | null;
  prevM2: number | null;
  yoyM: number | null;
  yoyM2: number | null;
}

export interface SipIndustryAuto {
  labels: SipPeriodLabels;
  values: SipIndustryValues;
  // The current anchor month (year/month, 1-12) -- the last real AMFI
  // month by default, or the global override below when one is set.
  anchorYear: number;
  anchorMonth: number;
  // The next not-yet-reported month, estimated as a copy of the TRUE
  // latest real month -- null when the global estimate toggle is off.
  estimate: SipIndustryEstimate | null;
}

const SIP_INDUSTRY_ANCHOR_KEY = "sip_industry_anchor_month";

// Industry-wide, not per-AMC: a single global "which month counts as
// latest" pin shared by BOTH SIP Industry cards (Monthly and Quarterly --
// a month always implies exactly one fiscal quarter, so one setting drives
// both). Stored in app_settings (same key-value table/pattern as
// current_report_period, usd_inr_rate, etc. -- see foreign-pricing.ts) --
// NOT a per-AMC amc_fortnightly_update column, since the figure is
// identical for every AMC and a per-row version meant repeating the same
// fix 8 times and losing it on every new snapshot. Absent (null) = no
// override, which is the normal state -- "latest" then just means the
// last real row in industry_monthly_flow, no synthetic guess.
export async function getSipIndustryAnchorOverride(): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SIP_INDUSTRY_ANCHOR_KEY));
  return row?.value ?? null;
}

export async function setSipIndustryAnchorOverride(month: string | null): Promise<void> {
  if (month === null) {
    await db.delete(appSettings).where(eq(appSettings.key, SIP_INDUSTRY_ANCHOR_KEY));
    return;
  }
  await db
    .insert(appSettings)
    .values({ key: SIP_INDUSTRY_ANCHOR_KEY, value: month })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: month, updatedAt: new Date() } });
}

// The quarter picker's own anchor (used by the Quarterly card) maps to the
// LAST REAL AMFI month that actually falls inside the picked quarter, not
// that quarter's first calendar month -- e.g. picking Q2FY27 (Jul-Sep
// 2026, all 3 months already real) resolves to September, the real data
// that's actually there. Returns null when no month in that quarter has
// real data yet (e.g. Q3FY27 right now) -- the caller (the API route)
// treats that as "nothing to anchor to" rather than silently guessing.
// `flows` must be ascending by monthEndDate (getAllMonthlyFlows's own
// order), so the last matching entry is the most recent one.
export function getLastRealMonthInQuarter(flows: MonthlyFlowPoint[], fy: number, quarter: number): string | null {
  const bounds = getFiscalQuarterBounds(fiscalQuarterAnchorDate(fy, quarter));
  const inRange = flows.filter((f) => f.monthEndDate >= bounds.start && f.monthEndDate <= bounds.end);
  return inRange.length === 0 ? null : inRange[inRange.length - 1].monthEndDate;
}

const SIP_INDUSTRY_SHOW_ESTIMATE_KEY = "sip_industry_show_estimate";

// Global, persisted (same mechanism as the anchor override above) toggle
// for the "(Estimated)" next-period row both SIP Industry cards can show
// -- see SipIndustryEstimate below.
export async function getSipIndustryShowEstimate(): Promise<boolean> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SIP_INDUSTRY_SHOW_ESTIMATE_KEY));
  return row?.value === "true";
}

export async function setSipIndustryShowEstimate(enabled: boolean): Promise<void> {
  if (!enabled) {
    await db.delete(appSettings).where(eq(appSettings.key, SIP_INDUSTRY_SHOW_ESTIMATE_KEY));
    return;
  }
  await db
    .insert(appSettings)
    .values({ key: SIP_INDUSTRY_SHOW_ESTIMATE_KEY, value: "true" })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: "true", updatedAt: new Date() } });
}


// One extra, clearly-marked row each SIP Industry card can show (when
// getSipIndustryShowEstimate() is on) projecting the next not-yet-reported
// period by assuming it repeats the latest REAL month's own figure --
// confirmed with the user via a worked 3-stage example (0, then 1, then 2
// of a quarter's 3 months already real) that one rule covers all of them:
// sum of that period's already-real months + (missing months x the
// latest real month's own figure). Always anchored to the TRUE latest
// real month (flows[flows.length-1]), independent of any anchor override
// -- these are two separate concerns (one shows what's really latest, the
// other previews what's probably coming next).
export interface SipIndustryEstimate {
  label: string;
  valueCr: number;
  yoyPct: number | null;
}

// Auto-pulled default for "SIP Industry Growth" -- the same industry-wide
// monthly SIP figure the Summary tab's own "Industry Flows" panel already
// tracks (industry_monthly_flow / getAllMonthlyFlows), so this never needs
// re-entering by hand for each of the 8 AMCs. "Latest available month"
// always means the last real AMFI month -- no forward-rolling placeholder
// guess (confirmed with the user: unlike flows-view.ts's own
// computeFlowsViewData, which keeps its separate "one rolling synthetic
// month" convention for the Summary tab's different display, this card
// should only ever show real data unless explicitly overridden).
//
// The global override (getSipIndustryAnchorOverride), when set, replaces
// the default entirely -- every one of the 5 periods below is then looked
// up relative to it instead. Deliberately NOT gated by this snapshot's own
// asOfDate -- industry-wide SIP has no "as of a past date" concept the way
// this app's per-AMC AUM history does; it always reflects whatever's
// currently the latest real entry (or the override).
export async function getSipIndustryAutoValues(): Promise<SipIndustryAuto | null> {
  const flows = await getAllMonthlyFlows();
  if (flows.length === 0) return null;
  const latestReal = flows[flows.length - 1];

  const override = await getSipIndustryAnchorOverride();
  const anchorMonth = override ? monthEndOf(`${override}-01`) : latestReal.monthEndDate;
  const [anchorYear, anchorMonthNum] = anchorMonth.split("-").map(Number);

  const sipByMonthEnd = new Map(flows.map((f) => [f.monthEndDate, f.sipContributionsCr]));

  let estimate: SipIndustryEstimate | null = null;
  if (await getSipIndustryShowEstimate()) {
    const nextMonth = monthEndOf(subtractMonths(latestReal.monthEndDate, -1));
    const yoyBase = sipByMonthEnd.get(monthEndOf(subtractMonths(nextMonth, 12))) ?? null;
    estimate = {
      label: `${monthEndToLabel(nextMonth)} (Est.)`,
      valueCr: latestReal.sipContributionsCr,
      yoyPct: yoyBase !== null && yoyBase !== 0 ? latestReal.sipContributionsCr / yoyBase - 1 : null,
    };
  }

  const monthEnds = {
    mtd: anchorMonth,
    prevM: monthEndOf(subtractMonths(anchorMonth, 1)),
    prevM2: monthEndOf(subtractMonths(anchorMonth, 2)),
    yoyM: monthEndOf(subtractMonths(anchorMonth, 12)),
    yoyM2: monthEndOf(subtractMonths(anchorMonth, 13)),
  };

  return {
    labels: {
      qtd: monthEndToLabel(monthEnds.mtd),
      prevQ: monthEndToLabel(monthEnds.prevM),
      prevQ2: monthEndToLabel(monthEnds.prevM2),
      yoyQ: monthEndToLabel(monthEnds.yoyM),
      yoyQ2: monthEndToLabel(monthEnds.yoyM2),
    },
    values: {
      mtd: sipByMonthEnd.get(monthEnds.mtd) ?? null,
      prevM: sipByMonthEnd.get(monthEnds.prevM) ?? null,
      prevM2: sipByMonthEnd.get(monthEnds.prevM2) ?? null,
      yoyM: sipByMonthEnd.get(monthEnds.yoyM) ?? null,
      yoyM2: sipByMonthEnd.get(monthEnds.yoyM2) ?? null,
    },
    anchorYear,
    anchorMonth: anchorMonthNum,
    estimate,
  };
}

export interface SipIndustryQuarterlyValues {
  qtd: number | null;
  prevQ: number | null;
  prevQ2: number | null;
  yoyQ: number | null;
  yoyQ2: number | null;
}

export interface SipIndustryQuarterlyAuto {
  labels: SipPeriodLabels;
  values: SipIndustryQuarterlyValues;
  anchorFy: number;
  anchorQuarter: number;
  // The next not-yet-fully-reported quarter, estimated per
  // SipIndustryEstimate's own rule -- null when the toggle is off.
  estimate: SipIndustryEstimate | null;
}

// Quarterly counterpart of getSipIndustryAutoValues -- same
// industry_monthly_flow source, same global override
// (getSipIndustryAnchorOverride -- one setting drives both cards, since a
// month always implies exactly one fiscal quarter), and the same "latest
// means the last real month, no placeholder" default. Sums 3 months per
// fiscal quarter instead of looking up a single month, since
// sipContributionsCr is a flow (not an AUM level) -- the same aggregation
// flows-view.ts's own buildQuarterBlock/sumInRange already use for the
// Summary tab's Industry Flows quarter view. A separate, local
// implementation (not a call into flows-view.ts) per this file's own
// convention of keeping each feature's aggregation local rather than
// reaching into another feature's already-verified logic.
export async function getSipIndustryQuarterlyAutoValues(): Promise<SipIndustryQuarterlyAuto | null> {
  const flows = await getAllMonthlyFlows();
  if (flows.length === 0) return null;
  const latestReal = flows[flows.length - 1];

  const sumQuarter = (start: string, end: string): number | null => {
    const real = flows.filter((f) => f.monthEndDate >= start && f.monthEndDate <= end);
    if (real.length === 0) return null;
    return real.reduce((s, f) => s + f.sipContributionsCr, 0);
  };

  const override = await getSipIndustryAnchorOverride();
  const anchorDate = override ? monthEndOf(`${override}-01`) : latestReal.monthEndDate;
  const { fy: anchorFy, q: anchorQuarter } = getFiscalYearAndQuarter(anchorDate);

  const q0 = getFiscalQuarterBounds(fiscalQuarterAnchorDate(anchorFy, anchorQuarter));
  const q1 = getPreviousFiscalQuarterBounds(q0.start);
  const q2 = getPreviousFiscalQuarterBounds(q1.start);
  const yoy0 = getFiscalQuarterBounds(fiscalQuarterAnchorDate(anchorFy - 1, anchorQuarter));
  const yoy1Fyq = getFiscalYearAndQuarter(q1.start);
  const yoy1 = getFiscalQuarterBounds(fiscalQuarterAnchorDate(yoy1Fyq.fy - 1, yoy1Fyq.q));

  let estimate: SipIndustryEstimate | null = null;
  if (await getSipIndustryShowEstimate()) {
    const nextMonth = monthEndOf(subtractMonths(latestReal.monthEndDate, -1));
    const { fy: estFy, q: estQuarter } = getFiscalYearAndQuarter(nextMonth);
    const estBounds = getFiscalQuarterBounds(fiscalQuarterAnchorDate(estFy, estQuarter));
    const realInQuarter = flows.filter((f) => f.monthEndDate >= estBounds.start && f.monthEndDate <= estBounds.end);
    const realSum = realInQuarter.reduce((s, f) => s + f.sipContributionsCr, 0);
    const missingMonths = 3 - realInQuarter.length;
    const estimatedTotal = realSum + missingMonths * latestReal.sipContributionsCr;
    const estYoyBounds = getFiscalQuarterBounds(fiscalQuarterAnchorDate(estFy - 1, estQuarter));
    const yoyTotal = sumQuarter(estYoyBounds.start, estYoyBounds.end);
    estimate = {
      label: `${getSipAmcPeriodLabels(estFy, estQuarter).qtd} (Est.)`,
      valueCr: estimatedTotal,
      yoyPct: yoyTotal !== null && yoyTotal !== 0 ? estimatedTotal / yoyTotal - 1 : null,
    };
  }

  return {
    labels: getSipAmcPeriodLabels(anchorFy, anchorQuarter),
    values: {
      qtd: sumQuarter(q0.start, q0.end),
      prevQ: sumQuarter(q1.start, q1.end),
      prevQ2: sumQuarter(q2.start, q2.end),
      yoyQ: sumQuarter(yoy0.start, yoy0.end),
      yoyQ2: sumQuarter(yoy1.start, yoy1.end),
    },
    anchorFy,
    anchorQuarter,
    estimate,
  };
}
