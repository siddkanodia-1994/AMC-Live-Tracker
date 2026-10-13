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
import { computeRangeCutoffDate, filterByCutoff } from "./date-range";
import { computeSummaryViewData, type QuarterRow } from "./summary-view";
import { getAmcAumHistory, getAmcListedStockPriceHistoryForIsins, type AmcStockPricePoint } from "./history";
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
  sipIndustryMtdValCr: number | null;
  sipIndustryPrevMValCr: number | null;
  sipIndustryPrevM2ValCr: number | null;
  sipIndustryYoyMValCr: number | null;
  sipIndustryYoyM2ValCr: number | null;
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
  "sipIndustryMtdValCr",
  "sipIndustryPrevMValCr",
  "sipIndustryPrevM2ValCr",
  "sipIndustryYoyMValCr",
  "sipIndustryYoyM2ValCr",
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
    sipIndustryMtdValCr: toNum(row.sipIndustryMtdValCr),
    sipIndustryPrevMValCr: toNum(row.sipIndustryPrevMValCr),
    sipIndustryPrevM2ValCr: toNum(row.sipIndustryPrevM2ValCr),
    sipIndustryYoyMValCr: toNum(row.sipIndustryYoyMValCr),
    sipIndustryYoyM2ValCr: toNum(row.sipIndustryYoyM2ValCr),
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

export function getSipAmcPeriodLabels(asOfDate: string): SipPeriodLabels {
  const cur = getFiscalYearAndQuarter(asOfDate);
  const prevQBounds = getPreviousFiscalQuarterBounds(asOfDate);
  const prevQ = getFiscalYearAndQuarter(prevQBounds.start);
  const prevQ2Bounds = getPreviousFiscalQuarterBounds(prevQBounds.start);
  const prevQ2 = getFiscalYearAndQuarter(prevQ2Bounds.start);
  const label = (fy: number, q: number) => `Q${q}FY${String(fy).slice(-2)}`;
  return {
    qtd: label(cur.fy, cur.q),
    prevQ: label(prevQ.fy, prevQ.q),
    prevQ2: label(prevQ2.fy, prevQ2.q),
    yoyQ: label(cur.fy - 1, cur.q),
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

export function getSipIndustryPeriodLabels(asOfDate: string): SipPeriodLabels {
  const [y, m] = asOfDate.split("-").map(Number);
  const step = (fromYear: number, fromMonth0: number, back: number) => {
    const total = fromYear * 12 + fromMonth0 - back;
    return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 };
  };
  const cur = { year: y, month0: m - 1 };
  const prev = step(y, m - 1, 1);
  const prev2 = step(y, m - 1, 2);
  const yoy = step(y, m - 1, 12);
  const yoy2 = step(y, m - 1, 13);
  return {
    qtd: monthLabel(cur.year, cur.month0),
    prevQ: monthLabel(prev.year, prev.month0),
    prevQ2: monthLabel(prev2.year, prev2.month0),
    yoyQ: monthLabel(yoy.year, yoy.month0),
    yoyQ2: monthLabel(yoy2.year, yoy2.month0),
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
  sipIndustryLabels: SipPeriodLabels;
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

  const aumAsOf = aumHistory.filter((p) => p.date <= asOfDate);
  const qaaum = computeSummaryViewData(aumAsOf, "average", asOfDate).quarter;

  const stockPriceSeries = listedStock ? (priceByIsin.get(listedStock.isin) ?? []) : [];
  const ratio = listedStock
    ? computeRatioSection({ aumHistory, stockPriceSeries }, asOfDate, correlationSettings)
    : null;

  const valuation = computeValuationBlock(manual, cmpInr);

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
    sipAmcLabels: getSipAmcPeriodLabels(asOfDate),
    sipIndustryLabels: getSipIndustryPeriodLabels(asOfDate),
    manual,
    valuation,
  };
}
