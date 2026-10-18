import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "../db/client";
import { amcFortnightlyUpdate, amcListedStock, amcs, appSettings, isinDailyPrice } from "../db/schema";
import { getStockCorrelationDefaults } from "../amc-stock/correlation-defaults";
import {
  trimToLastContinuousRun,
  computeMovingAverage,
  computeCorrelationStats,
  computeLevelCorrelationStats,
  priceToAumRatioStats,
  alignSeriesByDate,
  type DatedValue,
} from "./series-math";
import { computeRangeCutoffDate, filterByCutoff, subtractMonths } from "./date-range";
import { computeSummaryViewData, type FlowAdjustment, type QuarterRow } from "./summary-view";
import { getAmcAumHistory, getAmcListedStockPriceHistoryForIsins, getEffectiveNetFlowForPeriod, type AmcStockPricePoint } from "./history";
import { getAllMonthlyFlows, type MonthlyFlowPoint } from "./industry-flows";
import { getAmcScoreForOverviewName, type AmcScoreCard } from "./amc-score";
import {
  getFiscalQuarterBounds,
  getPreviousFiscalQuarterBounds,
  getFiscalYearAndQuarter,
} from "./report-period";
import { getIstDateString } from "../utils/date";

// ---------------------------------------------------------------------
// Manual fields -- exactly the amc_fortnightly_update columns, as plain
// numbers (null = never entered). One POST field name per key here.
// ---------------------------------------------------------------------
export interface FortnightlyManualFields {
  noOfSharesCr: number | null;
  patFy26aCr: number | null;
  patFy27eCr: number | null;
  patFy28eCr: number | null;
  targetPeBear: number | null;
  targetPeBase: number | null;
  targetPeBull: number | null;
  discountRateFy27Pct: number | null;
  discountRateFy26Pct: number | null;
  sipAmcQtdValCr: number | null;
  sipAmcQtdPct: number | null;
  sipAmcPrevQValCr: number | null;
  sipAmcPrevQPct: number | null;
  sipAmcPrevQ2ValCr: number | null;
  sipAmcPrevQ2Pct: number | null;
  sipAmcYoyQValCr: number | null;
  sipAmcYoyQPct: number | null;
  sipAmcYoyQ2ValCr: number | null;
  sipAmcYoyQ2Pct: number | null;
  sipAmcLatestFy: number | null;
  sipAmcLatestQuarter: number | null;
  sipIndustryMtdValCr: number | null;
  sipIndustryPrevMValCr: number | null;
  sipIndustryPrevM2ValCr: number | null;
  sipIndustryYoyMValCr: number | null;
  sipIndustryYoyM2ValCr: number | null;
  sipIndustryQtrQtdValCr: number | null;
  sipIndustryQtrPrevQValCr: number | null;
  sipIndustryQtrPrevQ2ValCr: number | null;
  sipIndustryQtrYoyQValCr: number | null;
  sipIndustryQtrYoyQ2ValCr: number | null;
  amcScoreAnchorDate: string | null;
  summary: string | null;
  verdictOverride: VerdictTier | null;
}

export const VERDICT_TIERS = ["buy", "accumulate", "hold", "reduce", "sell"] as const;
export type VerdictTier = (typeof VERDICT_TIERS)[number];

export const MANUAL_FIELD_NAMES = [
  "noOfSharesCr",
  "patFy26aCr",
  "patFy27eCr",
  "patFy28eCr",
  "targetPeBear",
  "targetPeBase",
  "targetPeBull",
  "discountRateFy27Pct",
  "discountRateFy26Pct",
  "sipAmcQtdValCr",
  "sipAmcQtdPct",
  "sipAmcPrevQValCr",
  "sipAmcPrevQPct",
  "sipAmcPrevQ2ValCr",
  "sipAmcPrevQ2Pct",
  "sipAmcYoyQValCr",
  "sipAmcYoyQPct",
  "sipAmcYoyQ2ValCr",
  "sipAmcYoyQ2Pct",
  "sipAmcLatestFy",
  "sipAmcLatestQuarter",
  "sipIndustryMtdValCr",
  "sipIndustryPrevMValCr",
  "sipIndustryPrevM2ValCr",
  "sipIndustryYoyMValCr",
  "sipIndustryYoyM2ValCr",
  "sipIndustryQtrQtdValCr",
  "sipIndustryQtrPrevQValCr",
  "sipIndustryQtrPrevQ2ValCr",
  "sipIndustryQtrYoyQValCr",
  "sipIndustryQtrYoyQ2ValCr",
  "amcScoreAnchorDate",
  "summary",
  "verdictOverride",
] as const satisfies readonly (keyof FortnightlyManualFields)[];

export type FortnightlyFieldName = (typeof MANUAL_FIELD_NAMES)[number];

const EMPTY_MANUAL: FortnightlyManualFields = Object.fromEntries(
  MANUAL_FIELD_NAMES.map((k) => [k, null])
) as unknown as FortnightlyManualFields;

function toNum(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function rowToManualFields(row: typeof amcFortnightlyUpdate.$inferSelect): FortnightlyManualFields {
  return {
    noOfSharesCr: toNum(row.noOfSharesCr),
    patFy26aCr: toNum(row.patFy26aCr),
    patFy27eCr: toNum(row.patFy27eCr),
    patFy28eCr: toNum(row.patFy28eCr),
    targetPeBear: toNum(row.targetPeBear),
    targetPeBase: toNum(row.targetPeBase),
    targetPeBull: toNum(row.targetPeBull),
    discountRateFy27Pct: toNum(row.discountRateFy27Pct),
    discountRateFy26Pct: toNum(row.discountRateFy26Pct),
    sipAmcQtdValCr: toNum(row.sipAmcQtdValCr),
    sipAmcQtdPct: toNum(row.sipAmcQtdPct),
    sipAmcPrevQValCr: toNum(row.sipAmcPrevQValCr),
    sipAmcPrevQPct: toNum(row.sipAmcPrevQPct),
    sipAmcPrevQ2ValCr: toNum(row.sipAmcPrevQ2ValCr),
    sipAmcPrevQ2Pct: toNum(row.sipAmcPrevQ2Pct),
    sipAmcYoyQValCr: toNum(row.sipAmcYoyQValCr),
    sipAmcYoyQPct: toNum(row.sipAmcYoyQPct),
    sipAmcYoyQ2ValCr: toNum(row.sipAmcYoyQ2ValCr),
    sipAmcYoyQ2Pct: toNum(row.sipAmcYoyQ2Pct),
    sipAmcLatestFy: toNum(row.sipAmcLatestFy),
    sipAmcLatestQuarter: toNum(row.sipAmcLatestQuarter),
    sipIndustryMtdValCr: toNum(row.sipIndustryMtdValCr),
    sipIndustryPrevMValCr: toNum(row.sipIndustryPrevMValCr),
    sipIndustryPrevM2ValCr: toNum(row.sipIndustryPrevM2ValCr),
    sipIndustryYoyMValCr: toNum(row.sipIndustryYoyMValCr),
    sipIndustryYoyM2ValCr: toNum(row.sipIndustryYoyM2ValCr),
    sipIndustryQtrQtdValCr: toNum(row.sipIndustryQtrQtdValCr),
    sipIndustryQtrPrevQValCr: toNum(row.sipIndustryQtrPrevQValCr),
    sipIndustryQtrPrevQ2ValCr: toNum(row.sipIndustryQtrPrevQ2ValCr),
    sipIndustryQtrYoyQValCr: toNum(row.sipIndustryQtrYoyQValCr),
    sipIndustryQtrYoyQ2ValCr: toNum(row.sipIndustryQtrYoyQ2ValCr),
    amcScoreAnchorDate: row.amcScoreAnchorDate,
    summary: row.summary,
    verdictOverride: isVerdictTier(row.verdictOverride) ? row.verdictOverride : null,
  };
}

function isVerdictTier(v: string | null): v is VerdictTier {
  return v !== null && (VERDICT_TIERS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------
// Snapshot listing / lookup
// ---------------------------------------------------------------------

export interface EligibleAmc {
  amcId: number;
  slug: string;
  overviewName: string;
}

/** The 8 amc_listed_stock AMCs this tab is scoped to, for the AMC switcher and the multi-AMC download picker. */
export async function getFortnightlyEligibleAmcs(): Promise<EligibleAmc[]> {
  const rows = await db
    .select({ amcId: amcListedStock.amcId, slug: amcs.slug, overviewName: amcs.overviewName })
    .from(amcListedStock)
    .innerJoin(amcs, eq(amcListedStock.amcId, amcs.id));
  return rows.sort((a, b) => a.overviewName.localeCompare(b.overviewName));
}

export async function getFortnightlySnapshotDates(amcId: number): Promise<string[]> {
  const rows = await db
    .select({ asOfDate: amcFortnightlyUpdate.asOfDate })
    .from(amcFortnightlyUpdate)
    .where(eq(amcFortnightlyUpdate.amcId, amcId))
    .orderBy(desc(amcFortnightlyUpdate.asOfDate));
  return rows.map((r) => r.asOfDate);
}

async function getMostRecentSnapshotOnOrBefore(
  amcId: number,
  asOfDate: string
): Promise<typeof amcFortnightlyUpdate.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(amcFortnightlyUpdate)
    .where(and(eq(amcFortnightlyUpdate.amcId, amcId), lte(amcFortnightlyUpdate.asOfDate, asOfDate)))
    .orderBy(desc(amcFortnightlyUpdate.asOfDate))
    .limit(1);
  return row ?? null;
}

/** Creates a new dated snapshot, copying forward the most recent prior entry's manual values (or blank if there is none). */
export async function createFortnightlySnapshot(amcId: number, asOfDate: string): Promise<void> {
  const prior = await getMostRecentSnapshotOnOrBefore(amcId, asOfDate);
  const carryForward = prior ? rowToManualFields(prior) : EMPTY_MANUAL;
  // Unlike every other manual field, the AMC Score anchor date deliberately
  // does NOT carry forward -- it's a one-off override (e.g. to look at an
  // older snapshot), so it would otherwise go stale and silently keep
  // applying fortnight after fortnight. Each new snapshot starts back at
  // the auto-detected default (the latest amc_scores snapshot).
  //
  // The SIP Industry "latest available" anchor used to live here too, but
  // is now a single GLOBAL setting (sip_industry_anchor_month in
  // app_settings, see getSipIndustryAnchorOverride/setSipIndustryAnchorOverride
  // below) rather than a per-AMC-row field -- it's industry-wide data, the
  // same for every AMC, so a per-row override meant repeating the same fix
  // 8 times and losing it on every new snapshot. The global setting is
  // untouched by snapshot creation entirely.
  carryForward.amcScoreAnchorDate = null;
  await db
    .insert(amcFortnightlyUpdate)
    .values({ amcId, asOfDate, ...toDbValues(carryForward) })
    .onConflictDoNothing({ target: [amcFortnightlyUpdate.amcId, amcFortnightlyUpdate.asOfDate] });
}

/**
 * Cron step: auto-creates today's fortnightly snapshot row for every
 * eligible AMC, carrying forward manual fields the same way the "+ New
 * fortnightly update" button does. Idempotent (onConflictDoNothing), safe
 * to call every day even if some/all AMCs already have today's row.
 */
export async function createDailyFortnightlySnapshots(asOfDate: string): Promise<number> {
  const amcList = await getFortnightlyEligibleAmcs();
  for (const amc of amcList) {
    await createFortnightlySnapshot(amc.amcId, asOfDate);
  }
  return amcList.length;
}

function toDbValues(fields: FortnightlyManualFields): Record<string, string | null> {
  return Object.fromEntries(
    MANUAL_FIELD_NAMES.map((k) => [k, fields[k] === null ? null : String(fields[k])])
  );
}

export async function saveFortnightlyField(
  amcId: number,
  asOfDate: string,
  field: FortnightlyFieldName,
  value: number | string | null
): Promise<void> {
  const dbValue = value === null ? null : String(value);
  await db
    .insert(amcFortnightlyUpdate)
    .values({ amcId, asOfDate, [field]: dbValue })
    .onConflictDoUpdate({
      target: [amcFortnightlyUpdate.amcId, amcFortnightlyUpdate.asOfDate],
      set: { [field]: dbValue, updatedAt: new Date() },
    });
}

// ---------------------------------------------------------------------
// Pulled-from-dashboard data, all computed AS OF a given date
// ---------------------------------------------------------------------

/** Latest EOD close on or before asOfDate for this AMC's listed stock, or null if none exists yet. */
export async function getEodPriceAsOf(amcId: number, asOfDate: string): Promise<number | null> {
  const [listedStock] = await db.select().from(amcListedStock).where(eq(amcListedStock.amcId, amcId));
  if (!listedStock) return null;
  const [row] = await db
    .select({ priceInr: isinDailyPrice.priceInr })
    .from(isinDailyPrice)
    .where(and(eq(isinDailyPrice.isin, listedStock.isin), lte(isinDailyPrice.snapshotDate, asOfDate)))
    .orderBy(desc(isinDailyPrice.snapshotDate))
    .limit(1);
  return row ? Number(row.priceInr) : null;
}

export interface RatioSection {
  sdLevel: number | null; // Z-score of today's own ratio vs its historical mean
  upsideToMeanPct: number | null; // "Upside %" at ratioBasis "mean"
  // The price implied by the ratio reverting to its own historical mean
  // (mean ratio * avg AUM) -- the same figure the Stock Correlation tab
  // exposes as ComputedRow.fairValuePriceInr at ratioBasis "mean". Was
  // already computed here to derive upsideToMeanPct above but discarded;
  // now exposed directly for the Ratio card's own "Mean Target Price" row.
  fairValueAtMeanInr: number | null;
  correlationPct: number | null;
  rSquared: number | null;
  timePeriodLabel: string; // e.g. "3 Years" -- from the shared Stock Correlation range setting
  avgAumDays: number; // the shared Stock Correlation moving-avg-days setting
}

// Mirrors stock-correlation-table.tsx's own computeRow pipeline exactly
// (same shared series-math/date-range helpers, same shared global
// range/maDays/aumOnlyAveraging/levelsCorrelation settings), just scoped to
// data <= asOfDate instead of "all data up to right now" -- kept as an
// independent function rather than extracting/refactoring computeRow
// itself, so this new tab can never risk regressing the already-shipped
// Stock Correlation tab.
function computeRatioSection(
  entry: { aumHistory: import("./history").AumHistoryPoint[]; stockPriceSeries: AmcStockPricePoint[] },
  asOfDate: string,
  settings: { range: import("./date-range").RangeOption; maDays: number; aumOnlyAveraging: boolean; levelsCorrelation: boolean }
): RatioSection | null {
  const aumHistory = entry.aumHistory.filter((p) => p.date <= asOfDate);
  const priceHistory = entry.stockPriceSeries.filter((p) => p.date <= asOfDate);
  const data = trimToLastContinuousRun(aumHistory);
  if (data.length === 0 || priceHistory.length === 0) return null;

  const aumDisplay = computeMovingAverage(data.map((d) => d.liveAumCr), settings.maDays);
  const priceDisplay = settings.aumOnlyAveraging
    ? priceHistory.map((p) => p.priceInr)
    : computeMovingAverage(priceHistory.map((p) => p.priceInr), settings.maDays);

  const aumWithGapsFull = data.map((d, i) => ({ date: d.date, value: aumDisplay[i] }));
  const priceWithGapsFull = priceHistory.map((p, i) => ({ date: p.date, value: priceDisplay[i] }));
  const cutoffDate = computeRangeCutoffDate(aumWithGapsFull, settings.range);
  const aumWithGaps = filterByCutoff(aumWithGapsFull, cutoffDate);
  const priceWithGaps = filterByCutoff(priceWithGapsFull, cutoffDate);
  const aumDated: DatedValue[] = aumWithGaps.filter((d): d is DatedValue => d.value !== undefined);
  const priceDated: DatedValue[] = priceWithGaps.filter((d): d is DatedValue => d.value !== undefined);

  const corrStats = settings.levelsCorrelation
    ? computeLevelCorrelationStats(aumDated, priceDated)
    : computeCorrelationStats(aumDated, priceDated);
  const { xs, ys } = alignSeriesByDate(aumDated, priceDated);
  const ratioStats = priceToAumRatioStats(xs, ys);

  const avgAumCr = aumDisplay.length > 0 ? (aumDisplay[aumDisplay.length - 1] ?? null) : null;
  const avgPriceInr = priceDisplay.length > 0 ? (priceDisplay[priceDisplay.length - 1] ?? null) : null;
  const latestPriceInr = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1].priceInr : null;

  const fairValueAtMean = ratioStats && avgAumCr !== null ? ratioStats.meanRatio * avgAumCr : null;
  const upsideToMeanPct =
    fairValueAtMean !== null && latestPriceInr !== null && latestPriceInr !== 0
      ? (fairValueAtMean - latestPriceInr) / latestPriceInr
      : null;

  const currentRatio = avgAumCr !== null && avgAumCr !== 0 && avgPriceInr !== null ? avgPriceInr / avgAumCr : null;
  const sdLevel =
    currentRatio !== null && ratioStats && ratioStats.stdDev !== 0
      ? (currentRatio - ratioStats.meanRatio) / ratioStats.stdDev
      : null;

  const RANGE_LABELS: Record<string, string> = { "6m": "6 Months", "1y": "1 Year", "2y": "2 Years", "3y": "3 Years", all: "All" };

  return {
    sdLevel,
    upsideToMeanPct,
    fairValueAtMeanInr: fairValueAtMean,
    correlationPct: corrStats?.r ?? null,
    rSquared: corrStats?.r2 ?? null,
    timePeriodLabel: RANGE_LABELS[settings.range] ?? settings.range,
    avgAumDays: settings.maDays,
  };
}

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

// ---------------------------------------------------------------------
// Overview card: 5-tier verdict thresholds -- a single GLOBAL, persisted
// setting (same app_settings mechanism as the SIP Industry settings above)
// applying uniformly across all 8 AMCs. Analyst-editable (not hardcoded):
// 4 boundary numbers on Base-case Target Price upside % that carve it into
// Buy / Accumulate / Hold / Reduce / Sell bands, each strictly above the
// next (buyMinPct > accumulateMinPct > holdMinPct > reduceMinPct).
// ---------------------------------------------------------------------

export interface VerdictThresholds {
  buyMinPct: number; // upside > this -> Buy
  accumulateMinPct: number; // upside > this (<= buyMinPct) -> Accumulate
  holdMinPct: number; // upside > this (<= accumulateMinPct) -> Hold
  reduceMinPct: number; // upside > this (<= holdMinPct) -> Reduce; else Sell
}

const DEFAULT_VERDICT_THRESHOLDS: VerdictThresholds = {
  buyMinPct: 0.25,
  accumulateMinPct: 0.1,
  holdMinPct: -0.05,
  reduceMinPct: -0.15,
};

const VERDICT_THRESHOLD_KEYS: Record<keyof VerdictThresholds, string> = {
  buyMinPct: "verdict_threshold_buy",
  accumulateMinPct: "verdict_threshold_accumulate",
  holdMinPct: "verdict_threshold_hold",
  reduceMinPct: "verdict_threshold_reduce",
};

export async function getVerdictThresholds(): Promise<VerdictThresholds> {
  const keys = Object.values(VERDICT_THRESHOLD_KEYS);
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const resolve = (field: keyof VerdictThresholds) => {
    const stored = byKey.get(VERDICT_THRESHOLD_KEYS[field]);
    return stored !== undefined ? Number(stored) : DEFAULT_VERDICT_THRESHOLDS[field];
  };
  return {
    buyMinPct: resolve("buyMinPct"),
    accumulateMinPct: resolve("accumulateMinPct"),
    holdMinPct: resolve("holdMinPct"),
    reduceMinPct: resolve("reduceMinPct"),
  };
}

export async function setVerdictThresholds(thresholds: VerdictThresholds): Promise<void> {
  const fields = Object.keys(VERDICT_THRESHOLD_KEYS) as (keyof VerdictThresholds)[];
  await Promise.all(
    fields.map((field) => {
      const value = String(thresholds[field]);
      return db
        .insert(appSettings)
        .values({ key: VERDICT_THRESHOLD_KEYS[field], value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    })
  );
}

/** Auto-suggests a verdict from the Base-case Target Price upside % against the global thresholds -- null if upside isn't computable (e.g. no CMP or no manual valuation inputs yet). */
export function computeAutoVerdict(baseUpsidePct: number | null, thresholds: VerdictThresholds): VerdictTier | null {
  if (baseUpsidePct === null) return null;
  if (baseUpsidePct > thresholds.buyMinPct) return "buy";
  if (baseUpsidePct > thresholds.accumulateMinPct) return "accumulate";
  if (baseUpsidePct > thresholds.holdMinPct) return "hold";
  if (baseUpsidePct > thresholds.reduceMinPct) return "reduce";
  return "sell";
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

// ---------------------------------------------------------------------
// Valuation formulas -- pure arithmetic over manual fields only
// ---------------------------------------------------------------------

export interface ScenarioValues {
  bear: number | null;
  base: number | null;
  bull: number | null;
}

export interface ValuationBlock {
  cagr2yPct: number | null;
  fy28TargetMcapCr: ScenarioValues;
  fy28TargetPriceInr: ScenarioValues;
  fy28UpsidePct: ScenarioValues;
  fy27DiscountedPriceInr: ScenarioValues;
  fy27UpsidePct: ScenarioValues;
  fy26DiscountedPriceInr: ScenarioValues;
  fy26UpsidePct: ScenarioValues;
}

function mapScenario(pe: ScenarioValues, fn: (v: number) => number | null): ScenarioValues {
  return {
    bear: pe.bear === null ? null : fn(pe.bear),
    base: pe.base === null ? null : fn(pe.base),
    bull: pe.bull === null ? null : fn(pe.bull),
  };
}

export function computeValuationBlock(manual: FortnightlyManualFields, cmpInr: number | null): ValuationBlock {
  const cagr2yPct =
    manual.patFy26aCr !== null && manual.patFy28eCr !== null && manual.patFy26aCr > 0
      ? Math.pow(manual.patFy28eCr / manual.patFy26aCr, 1 / 2) - 1
      : null;

  const targetPe: ScenarioValues = { bear: manual.targetPeBear, base: manual.targetPeBase, bull: manual.targetPeBull };

  const fy28TargetMcapCr = mapScenario(targetPe, (pe) => (manual.patFy28eCr === null ? null : manual.patFy28eCr * pe));
  const fy28TargetPriceInr = mapScenario(
    { bear: fy28TargetMcapCr.bear, base: fy28TargetMcapCr.base, bull: fy28TargetMcapCr.bull },
    (mcap) => (manual.noOfSharesCr === null || manual.noOfSharesCr === 0 ? null : mcap / manual.noOfSharesCr)
  );
  const upsideVs = (target: ScenarioValues): ScenarioValues =>
    mapScenario(target, (price) => (cmpInr === null || cmpInr === 0 ? null : price / cmpInr - 1));

  const fy27Divisor = manual.discountRateFy27Pct === null ? null : 1 + manual.discountRateFy27Pct;
  const fy27DiscountedPriceInr = mapScenario(
    { bear: fy28TargetPriceInr.bear, base: fy28TargetPriceInr.base, bull: fy28TargetPriceInr.bull },
    (price) => (fy27Divisor === null || fy27Divisor === 0 ? null : price / fy27Divisor)
  );

  const fy26Divisor =
    manual.discountRateFy27Pct === null || manual.discountRateFy26Pct === null
      ? null
      : (1 + manual.discountRateFy27Pct) * (1 + manual.discountRateFy26Pct);
  const fy26DiscountedPriceInr = mapScenario(
    { bear: fy28TargetPriceInr.bear, base: fy28TargetPriceInr.base, bull: fy28TargetPriceInr.bull },
    (price) => (fy26Divisor === null || fy26Divisor === 0 ? null : price / fy26Divisor)
  );

  return {
    cagr2yPct,
    fy28TargetMcapCr,
    fy28TargetPriceInr,
    fy28UpsidePct: upsideVs(fy28TargetPriceInr),
    fy27DiscountedPriceInr,
    fy27UpsidePct: upsideVs(fy27DiscountedPriceInr),
    fy26DiscountedPriceInr,
    fy26UpsidePct: upsideVs(fy26DiscountedPriceInr),
  };
}

// ---------------------------------------------------------------------
// Overview card Summary parsing -- single source of truth shared by the
// live read-only table, the PDF export, and the Excel export, so the 3
// can never drift out of sync over what counts as "a new bullet" vs "a
// continuation line".
// ---------------------------------------------------------------------

export interface SummaryRow {
  label: string;
  // May itself contain an embedded "\n" when a bullet has a continuation
  // line (e.g. QAAUM's previous-quarter figures) -- every consumer
  // (autoTable, ExcelJS with wrapText, and the live table's own
  // white-space: pre-line) already renders an embedded "\n" as a second
  // line within the same cell/row.
  detail: string;
}

/**
 * Splits the stored plain-text summary into (label, detail) rows. A line
 * matching "• Label: detail" starts a new row; any other line is treated
 * as a CONTINUATION of the immediately preceding row (folded into its
 * detail as an extra line) rather than spawning its own empty-label row --
 * this is what lets a single bullet (like QAAUM) carry more than one
 * period's figures. General-purpose, not specific to any one bullet.
 */
export function parseSummaryRows(summary: string | null): SummaryRow[] {
  if (!summary || summary.length === 0) {
    return [{ label: "", detail: "No summary written yet." }];
  }
  const lines = summary.split("\n");
  const rows: SummaryRow[] = [];
  for (const line of lines) {
    const match = /^•\s*([^:]+):(.*)$/.exec(line);
    if (match) {
      rows.push({ label: match[1].trim(), detail: match[2].trim() });
    } else if (rows.length > 0) {
      rows[rows.length - 1].detail += `\n${line.trim()}`;
    } else {
      rows.push({ label: "", detail: line.trim() });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------
// Full sheet assembly
// ---------------------------------------------------------------------

export interface FortnightlySheet {
  amcId: number;
  slug: string;
  overviewName: string;
  asOfDate: string;
  isLatest: boolean;
  availableDates: string[];
  cmpInr: number | null;
  qaaum: QuarterRow[];
  ratio: RatioSection | null;
  sipAmcLabels: SipPeriodLabels;
  sipAmcLatestFy: number;
  sipAmcLatestQuarter: number;
  sipIndustryAuto: SipIndustryAuto | null;
  sipIndustryQuarterlyAuto: SipIndustryQuarterlyAuto | null;
  amcScore: AmcScoreCard | null;
  amcScoreAvailableDates: string[];
  manual: FortnightlyManualFields;
  valuation: ValuationBlock;
  verdictThresholds: VerdictThresholds;
  autoVerdict: VerdictTier | null;
}

// Local copy of the same read compute-live-aum.ts/overview-adjustments.ts/
// total-aum-growth.ts each already keep their own copy of -- null (not
// thrown) when no file has ever been imported, since this tab should just
// skip the flow estimate rather than break entirely.
async function getCurrentReportPeriod(): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "current_report_period"));
  return row?.value ?? null;
}

export async function getFortnightlySheet(
  amcId: number,
  requestedAsOfDate?: string,
  includeFlowEstimate?: boolean
): Promise<FortnightlySheet | null> {
  const [amc] = await db.select().from(amcs).where(eq(amcs.id, amcId));
  if (!amc) return null;

  const availableDates = await getFortnightlySnapshotDates(amcId);
  const asOfDate = requestedAsOfDate ?? availableDates[0] ?? getIstDateString();
  const isLatest = availableDates.length === 0 || asOfDate === availableDates[0];

  const [listedStock] = await db.select().from(amcListedStock).where(eq(amcListedStock.amcId, amcId));

  const [savedRow, cmpInr, aumHistory, priceByIsin, correlationSettings, sipIndustryAuto, sipIndustryQuarterlyAuto, verdictThresholds] =
    await Promise.all([
      db
        .select()
        .from(amcFortnightlyUpdate)
        .where(and(eq(amcFortnightlyUpdate.amcId, amcId), eq(amcFortnightlyUpdate.asOfDate, asOfDate)))
        .then((rows) => rows[0] ?? null),
      getEodPriceAsOf(amcId, asOfDate),
      getAmcAumHistory(amcId),
      // Scoped to just THIS AMC's own isin -- getAmcStockCorrelationData()
      // fetches all 8 AMCs at once (built for the Stock Correlation tab,
      // which shows all 8 side by side); reusing it here cost ~10s per
      // request (profiled), almost all wasted on the other 7 AMCs' history
      // this tab never uses.
      listedStock
        ? getAmcListedStockPriceHistoryForIsins([listedStock.isin], new Map([[listedStock.isin, listedStock.backfillFromDate]]))
        : Promise.resolve(new Map<string, AmcStockPricePoint[]>()),
      getStockCorrelationDefaults(),
      // Both now read a single GLOBAL override (not a per-AMC manual field),
      // so -- unlike before -- neither depends on `manual` below and both can
      // join this same Promise.all instead of waiting for it to resolve
      // first.
      getSipIndustryAutoValues(),
      getSipIndustryQuarterlyAutoValues(),
      // Also a global setting, independent of `manual` -- joins here too.
      getVerdictThresholds(),
    ]);

  const manual = savedRow ? rowToManualFields(savedRow) : EMPTY_MANUAL;

  // Still depends on `manual.amcScoreAnchorDate`, so this one alone can't
  // join the Promise.all above.
  const { card: amcScore, availableDates: amcScoreAvailableDates } = await getAmcScoreForOverviewName(
    amc.overviewName,
    manual.amcScoreAnchorDate
  );

  // Reuses the exact same mechanism already wired into the Overview table
  // and the Summary tab (flowAdjustmentForDate, gated on each row's own end
  // date) -- no special-casing for an older/frozen snapshot's own asOfDate:
  // today's current report period/net flow is the only figure that's ever
  // existed (there's no historical "what was current on that date" to look
  // up instead), and the per-row date gate already correctly limits this to
  // whichever row's own window reaches the still-open gap, exactly like it
  // already does for Summary. Always undefined (no fetch at all) unless the
  // caller actually asked for it.
  let flowAdjustment: FlowAdjustment | undefined;
  if (includeFlowEstimate) {
    const currentReportPeriod = await getCurrentReportPeriod();
    if (currentReportPeriod) {
      const netFlows = await getEffectiveNetFlowForPeriod(currentReportPeriod);
      const netFlow = netFlows.get(amcId);
      if (netFlow) flowAdjustment = { netFlowCr: netFlow.netFlowCr, reportPeriod: currentReportPeriod };
    }
  }

  const aumAsOf = aumHistory.filter((p) => p.date <= asOfDate);
  const qaaum = computeSummaryViewData(aumAsOf, "average", asOfDate, flowAdjustment).quarter;

  const stockPriceSeries = listedStock ? (priceByIsin.get(listedStock.isin) ?? []) : [];
  const ratio = listedStock
    ? computeRatioSection({ aumHistory, stockPriceSeries }, asOfDate, correlationSettings)
    : null;

  const valuation = computeValuationBlock(manual, cmpInr);
  const autoVerdict = computeAutoVerdict(valuation.fy28UpsidePct.base, verdictThresholds);

  const defaultFyQ = getFiscalYearAndQuarter(asOfDate);
  const sipAmcLatestFy = manual.sipAmcLatestFy ?? defaultFyQ.fy;
  const sipAmcLatestQuarter = manual.sipAmcLatestQuarter ?? defaultFyQ.q;

  return {
    amcId,
    slug: amc.slug,
    overviewName: amc.overviewName,
    asOfDate,
    isLatest,
    availableDates,
    cmpInr,
    qaaum,
    ratio,
    sipAmcLabels: getSipAmcPeriodLabels(sipAmcLatestFy, sipAmcLatestQuarter),
    sipAmcLatestFy,
    sipAmcLatestQuarter,
    sipIndustryAuto,
    sipIndustryQuarterlyAuto,
    amcScore,
    amcScoreAvailableDates,
    manual,
    valuation,
    verdictThresholds,
    autoVerdict,
  };
}
