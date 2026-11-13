import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "../db/client";
import { amcFortnightlyUpdate, amcListedStock, amcs, appSettings, instrumentMap, isinDailyPrice } from "../db/schema";
import { getStockCorrelationDefaults } from "../amc-stock/correlation-defaults";
import { fetchLtps, segmentKey } from "../dhan/client";
import type { ExchangeSegment } from "../dhan/types";
import { isMarketOpen } from "../utils/market-hours";
import {
  trimToLastContinuousRun,
  computeMovingAverage,
  computeCorrelationStats,
  computeLevelCorrelationStats,
  priceToAumRatioStats,
  alignSeriesByDate,
  type DatedValue,
} from "./series-math";
import { computeRangeCutoffDate, filterByCutoff } from "./date-range";
import { computeMonthlyGrowthRows, computeSummaryViewData, type FlowAdjustment, type MonthlyGrowthRow, type QuarterRow } from "./summary-view";
import { getAmcAumHistory, getAmcListedStockPriceHistoryForIsins, getEffectiveNetFlowForPeriod, type AmcStockPricePoint } from "./history";
import { getAmcScoreForOverviewName, type AmcScoreCard } from "./amc-score";
import { getFiscalYearAndQuarter } from "./report-period";
import { getIstDateString } from "../utils/date";
import { computeValuationBlock, type ValuationBlock } from "../valuation/valuation-block";
import {
  getSipAmcPeriodLabels,
  getSipIndustryAutoValues,
  getSipIndustryQuarterlyAutoValues,
  type SipIndustryAuto,
  type SipIndustryQuarterlyAuto,
  type SipPeriodLabels,
} from "./sip-industry-settings";

// Re-exported so existing importers keep working: these now live in
// neutral modules shared with AMC Analytics.
export * from "../valuation/valuation-block";
export * from "./amc-names";
export * from "./sip-industry-settings";

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
  revenueFy28eCr: number | null;
  targetMcapSalesBear: number | null;
  targetMcapSalesBase: number | null;
  targetMcapSalesBull: number | null;
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
  verdictOverride: VerdictOverrideValue | null;
  // The analyst's own free-typed verdict label -- only meaningful when
  // verdictOverride === "custom"; see getEffectiveVerdictLabel below.
  verdictCustomText: string | null;
}

export const VERDICT_TIERS = ["buy", "accumulate", "hold", "reduce", "sell"] as const;
export type VerdictTier = (typeof VERDICT_TIERS)[number];
// verdictOverride's own type -- one of the 5 fixed tiers, or "custom" to
// signal "use verdictCustomText instead". Deliberately NOT folded into
// VerdictTier itself: computeAutoVerdict's auto-suggestion can never be
// "custom" (that only ever comes from a manual override), and the 5-tier
// color maps/threshold logic stay a closed, literal 5-value enum.
export type VerdictOverrideValue = VerdictTier | "custom";

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
  "revenueFy28eCr",
  "targetMcapSalesBear",
  "targetMcapSalesBase",
  "targetMcapSalesBull",
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
  "verdictCustomText",
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
    revenueFy28eCr: toNum(row.revenueFy28eCr),
    targetMcapSalesBear: toNum(row.targetMcapSalesBear),
    targetMcapSalesBase: toNum(row.targetMcapSalesBase),
    targetMcapSalesBull: toNum(row.targetMcapSalesBull),
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
    verdictOverride: isVerdictOverrideValue(row.verdictOverride) ? row.verdictOverride : null,
    verdictCustomText: row.verdictCustomText,
  };
}

function isVerdictOverrideValue(v: string | null): v is VerdictOverrideValue {
  return v !== null && ((VERDICT_TIERS as readonly string[]).includes(v) || v === "custom");
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

/**
 * This AMC's own listed-stock live price right now, via the same DHAN LTP
 * feed already used for live holdings repricing (compute-live-aum.ts) --
 * null if the ISIN has no instrument_map entry or the DHAN call itself
 * fails (expired token, network error, etc). Callers fall back to
 * getEodPriceAsOf in every one of those cases, the same "degrade
 * gracefully, never error" convention used everywhere else DHAN is called.
 */
export async function getListedStockLivePrice(isin: string): Promise<number | null> {
  const [mapped] = await db
    .select({ securityId: instrumentMap.securityId, exchangeSegment: instrumentMap.exchangeSegment })
    .from(instrumentMap)
    .where(eq(instrumentMap.isin, isin));
  if (!mapped) return null;

  const item = { securityId: mapped.securityId, exchangeSegment: mapped.exchangeSegment as ExchangeSegment };
  const { pricesBySecurityId } = await fetchLtps([item]);
  return pricesBySecurityId.get(segmentKey(item)) ?? null;
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

/**
 * Single source of truth for "what does the Verdict pill/line actually
 * show" -- shared by the live Overview card, generateOverviewDraft's
 * "Verdict: X" bullet, the PDF banner, and the Excel Overview section, so
 * the 4 can never drift. `tier: null` tells every caller "use the
 * neutral/gray treatment, not a tier color" -- covers both "no verdict at
 * all yet" and "a custom label is in use" (arbitrary text has no
 * inherent sentiment to color by).
 */
export function getEffectiveVerdictLabel(
  manual: FortnightlyManualFields,
  autoVerdict: VerdictTier | null
): { label: string; tier: VerdictTier | null } {
  if (manual.verdictOverride === "custom") {
    const text = manual.verdictCustomText?.trim();
    return { label: text ? text.toUpperCase() : "CUSTOM", tier: null };
  }
  const tier = manual.verdictOverride ?? autoVerdict;
  return { label: tier ? tier.toUpperCase() : "—", tier };
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


// Fortnightly-tab-only share-price formatting: 1 decimal instead of the
// app-wide formatPriceInr's 2. Deliberately a separate function (not a
// change to formatPriceInr itself) since that helper is also used by
// Holdings, Backtest, AUM Trend Chart, Fair Value Explainer, Stock
// Correlation Table, Corrections Log, ETF tables, and the Admin
// weekend-price-anomalies page -- none of which this request touches.
export function formatFortnightlyPriceInr(priceInr: number): string {
  return `₹${priceInr.toLocaleString("en-IN", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })}`;
}

export interface FortnightlySheet {
  amcId: number;
  slug: string;
  overviewName: string;
  asOfDate: string;
  isLatest: boolean;
  availableDates: string[];
  cmpInr: number | null;
  // True only when cmpInr is a live DHAN quote fetched just now (market
  // open, viewing today's actual date, and the live fetch itself
  // succeeded) -- false for every other case, including a live fetch
  // attempt that failed and silently fell back to the last EOD close.
  cmpIsLive: boolean;
  qaaum: QuarterRow[];
  mtmMonthly: MonthlyGrowthRow[];
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
  includeFlowEstimate?: boolean,
  blendGoldSilver?: boolean
): Promise<FortnightlySheet | null> {
  const [amc] = await db.select().from(amcs).where(eq(amcs.id, amcId));
  if (!amc) return null;

  const availableDates = await getFortnightlySnapshotDates(amcId);
  const asOfDate = requestedAsOfDate ?? availableDates[0] ?? getIstDateString();
  const isLatest = availableDates.length === 0 || asOfDate === availableDates[0];

  const [listedStock] = await db.select().from(amcListedStock).where(eq(amcListedStock.amcId, amcId));

  const [savedRow, eodCmpInr, aumHistory, priceByIsin, correlationSettings, sipIndustryAuto, sipIndustryQuarterlyAuto, verdictThresholds] =
    await Promise.all([
      db
        .select()
        .from(amcFortnightlyUpdate)
        .where(and(eq(amcFortnightlyUpdate.amcId, amcId), eq(amcFortnightlyUpdate.asOfDate, asOfDate)))
        .then((rows) => rows[0] ?? null),
      getEodPriceAsOf(amcId, asOfDate),
      getAmcAumHistory(amcId, { blendGoldSilver }),
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
  const mtmMonthly = computeMonthlyGrowthRows(aumAsOf, "average", asOfDate, flowAdjustment);

  const stockPriceSeries = listedStock ? (priceByIsin.get(listedStock.isin) ?? []) : [];
  const ratio = listedStock
    ? computeRatioSection({ aumHistory, stockPriceSeries }, asOfDate, correlationSettings)
    : null;

  // CMP goes live only when viewing today's actual date with the market
  // open -- any older snapshot, even the latest one on file, always shows
  // its own EOD close so it never mixes a right-now price into a
  // valuation basis from a different day. The Ratio card's own SD-level/
  // upside-to-mean % deliberately keeps reading stockPriceSeries's last
  // EOD close above, unchanged, per explicit scoping.
  let cmpInr = eodCmpInr;
  let cmpIsLive = false;
  if (listedStock && asOfDate === getIstDateString() && isMarketOpen()) {
    const livePrice = await getListedStockLivePrice(listedStock.isin);
    if (livePrice !== null) {
      cmpInr = livePrice;
      cmpIsLive = true;
    }
  }

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
    cmpIsLive,
    qaaum,
    mtmMonthly,
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
