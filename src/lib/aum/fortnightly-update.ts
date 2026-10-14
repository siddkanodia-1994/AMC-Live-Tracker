import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "../db/client";
import { amcFortnightlyUpdate, amcListedStock, amcs, isinDailyPrice } from "../db/schema";
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
import { computeSummaryViewData, type QuarterRow } from "./summary-view";
import { getAmcAumHistory, getAmcListedStockPriceHistoryForIsins, type AmcStockPricePoint } from "./history";
import { getAllMonthlyFlows } from "./industry-flows";
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
  sipIndustryLatestYear: number | null;
  sipIndustryLatestMonth: number | null;
}

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
  "sipIndustryLatestYear",
  "sipIndustryLatestMonth",
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
    sipIndustryLatestYear: toNum(row.sipIndustryLatestYear),
    sipIndustryLatestMonth: toNum(row.sipIndustryLatestMonth),
  };
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
  // Unlike every other manual field, the SIP Industry "latest available
  // month" override deliberately does NOT carry forward -- the system's own
  // auto-detection already advances correctly on its own as real data
  // arrives, so a prior one-off override (e.g. to look at an older month)
  // would otherwise go stale and silently keep applying fortnight after
  // fortnight. Each new snapshot starts back at the auto-detected default.
  carryForward.sipIndustryLatestYear = null;
  carryForward.sipIndustryLatestMonth = null;
  await db
    .insert(amcFortnightlyUpdate)
    .values({ amcId, asOfDate, ...toDbValues(carryForward) })
    .onConflictDoNothing({ target: [amcFortnightlyUpdate.amcId, amcFortnightlyUpdate.asOfDate] });
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
  value: number | null
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
  // The system's own auto-detected "latest available month" (year/month,
  // 1-12) -- the fallback default shown in the picker, and what a brand-new
  // snapshot always resets to (see sipIndustryLatestYear/Month's "no
  // carry-forward" handling in createFortnightlySnapshot).
  defaultAnchorYear: number;
  defaultAnchorMonth: number;
}

// Auto-pulled default for "SIP Industry Growth" -- the same industry-wide
// monthly SIP figure the Summary tab's own "Industry Flows" panel already
// tracks (industry_monthly_flow / getAllMonthlyFlows), so this never needs
// re-entering by hand for each of the 8 AMCs. The system's OWN "latest
// available month" is NOT simply the current calendar month -- AMFI
// publishes with a lag, so it mirrors flows-view.ts's own
// computeFlowsViewData convention exactly: one synthetic month rolled
// forward from the latest REAL entry, carrying that same entry's own value
// as a placeholder (e.g. if August is the last real row, "latest" is
// labeled September and shows August's own figure, replaced automatically
// the moment a real September row is entered via the Admin form) --
// confirmed against that file's own documented design.
//
// `anchorOverride` lets the analyst manually pin a DIFFERENT month as
// "latest" for one snapshot (e.g. to temporarily look at an older month) --
// when given, every one of the 5 periods below is looked up relative to it
// instead of the system's own estimate, via the SAME sipByMonthEnd map (an
// already-real month just returns its own real figure; a month with
// neither real nor synthetic data comes back null, same as any other gap).
//
// Deliberately NOT gated by this snapshot's own asOfDate -- industry-wide
// SIP has no "as of a past date" concept the way this app's per-AMC AUM
// history does; it always reflects whatever's currently the latest entry
// (or the analyst's explicit override).
export async function getSipIndustryAutoValues(
  anchorOverride?: { year: number | null; month: number | null }
): Promise<SipIndustryAuto | null> {
  const flows = await getAllMonthlyFlows();
  if (flows.length === 0) return null;
  const latestReal = flows[flows.length - 1];
  const estimatedMonth = monthEndOf(subtractMonths(latestReal.monthEndDate, -1));
  const [defaultAnchorYear, defaultAnchorMonth] = estimatedMonth.split("-").map(Number);

  // Each half of the override resolves independently against its own
  // default -- the UI lets the analyst change just the month (or just the
  // year) at a time, so requiring BOTH to be explicitly set before any
  // override took effect silently ignored a lone month-only or year-only
  // pick.
  const anchorYear = anchorOverride?.year ?? defaultAnchorYear;
  const anchorMonthNum = anchorOverride?.month ?? defaultAnchorMonth;
  const anchorMonth = monthEndOf(`${anchorYear}-${String(anchorMonthNum).padStart(2, "0")}-01`);

  const sipByMonthEnd = new Map(flows.map((f) => [f.monthEndDate, f.sipContributionsCr]));
  sipByMonthEnd.set(estimatedMonth, latestReal.sipContributionsCr);

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
    defaultAnchorYear,
    defaultAnchorMonth,
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
  manual: FortnightlyManualFields;
  valuation: ValuationBlock;
}

export async function getFortnightlySheet(amcId: number, requestedAsOfDate?: string): Promise<FortnightlySheet | null> {
  const [amc] = await db.select().from(amcs).where(eq(amcs.id, amcId));
  if (!amc) return null;

  const availableDates = await getFortnightlySnapshotDates(amcId);
  const asOfDate = requestedAsOfDate ?? availableDates[0] ?? getIstDateString();
  const isLatest = availableDates.length === 0 || asOfDate === availableDates[0];

  const [listedStock] = await db.select().from(amcListedStock).where(eq(amcListedStock.amcId, amcId));

  const [savedRow, cmpInr, aumHistory, priceByIsin, correlationSettings] = await Promise.all([
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
  ]);

  const manual = savedRow ? rowToManualFields(savedRow) : EMPTY_MANUAL;

  // Depends on `manual` (the override, if any), so it can't join the
  // Promise.all above -- the analyst's picked month, when set, takes
  // precedence over the system's own auto-detected "latest available".
  const sipIndustryAuto = await getSipIndustryAutoValues({
    year: manual.sipIndustryLatestYear,
    month: manual.sipIndustryLatestMonth,
  });

  const aumAsOf = aumHistory.filter((p) => p.date <= asOfDate);
  const qaaum = computeSummaryViewData(aumAsOf, "average", asOfDate).quarter;

  const stockPriceSeries = listedStock ? (priceByIsin.get(listedStock.isin) ?? []) : [];
  const ratio = listedStock
    ? computeRatioSection({ aumHistory, stockPriceSeries }, asOfDate, correlationSettings)
    : null;

  const valuation = computeValuationBlock(manual, cmpInr);

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
    manual,
    valuation,
  };
}
