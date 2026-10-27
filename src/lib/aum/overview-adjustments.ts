import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings } from "../db/schema";
import type { IndexKey } from "../dhan/indices";
import { getIstDateString } from "../utils/date";
import { getAvailableReportPeriods } from "./aum-growth";
import {
  getAllAmcsLiveAumAsOf,
  getAverageAumForRange,
  getCanonicalSnapshotDateBounds,
  getFlowAdjustmentContext,
  getReportedAumForPeriod,
  type AverageAumRange,
} from "./history";
import { getAverageIndexLevelForRange, getIndexLevelsAsOf } from "./index-benchmarks";
import { getFiscalQuarterBounds, getPreviousFiscalQuarterBounds } from "./report-period";

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";

async function getCurrentReportPeriod(): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, CURRENT_REPORT_PERIOD_KEY));
  return row?.value ?? null;
}

// Each of the 7 heavy lookups below is independent of the others (confirmed
// by the Promise.all they already ran in) -- this lets a caller ask for only
// the slice(s) it actually needs instead of always paying for all 7. Omitting
// `fields` entirely (the default) computes every field, exactly as before
// this existed -- so any existing caller is unaffected.
export type OverviewAdjustmentsField =
  | "reportedAum"
  | "avgAum"
  | "currentAvgAum"
  | "histLiveAum"
  | "indexAvg"
  | "indexCurrentAvg"
  | "indexHistLive";

export const ALL_OVERVIEW_ADJUSTMENTS_FIELDS: OverviewAdjustmentsField[] = [
  "reportedAum",
  "avgAum",
  "currentAvgAum",
  "histLiveAum",
  "indexAvg",
  "indexCurrentAvg",
  "indexHistLive",
];

// The "wire" shape: a single field-scoped request only returns the heavy
// fields it actually asked for (see `fields` above) -- `undefined` means
// "not requested", never "computed and empty". Omitting `fields` entirely
// computes and returns every field, satisfying `OverviewAdjustments` below.
export interface OverviewAdjustmentsSlice {
  reportPeriod: string;
  availableReportPeriods: string[];
  reportedAumByAmcId?: Record<number, number>;
  avgFrom: string;
  avgTo: string;
  avgAumByAmcId?: Record<number, AverageAumRange>;
  currentAvgFrom: string;
  currentAvgTo: string;
  currentAvgAumByAmcId?: Record<number, AverageAumRange>;
  minSnapshotDate: string | null;
  maxSnapshotDate: string | null;
  // The Overview table's "Hist. Live AUM" toggle mode -- each AMC's live
  // (repriced) AUM as of an arbitrary past date, an alternative to
  // reportedAumByAmcId above. Defaults to the last day of the most
  // recently completed FISCAL QUARTER when not explicitly requested (same
  // prevQuarter used for the "Avg AUM" window default above) -- so it only
  // advances at quarter boundaries, not every month.
  histLiveDate: string;
  histLiveAumByAmcId?: Record<number, number>;
  // Same three windows/date above, applied to the Overview table's Nifty
  // 50/Nifty 500 benchmark rows instead of AMCs -- kept in lockstep with
  // the AMC figures (same avgFrom/avgTo/currentAvgFrom/currentAvgTo/
  // histLiveDate) so picking a custom window updates both together.
  indexAvgLevelByKey?: Record<IndexKey, number | null>;
  indexCurrentAvgLevelByKey?: Record<IndexKey, number | null>;
  indexHistLiveLevelByKey?: Record<IndexKey, number | null>;
}

// The full, every-field-present shape every existing consumer
// (amc-grid.tsx) was already written against -- what `useOverviewAdjustments`
// merges 4 field-scoped slices into once all 4 have resolved. Unchanged
// from before `OverviewAdjustmentsSlice` existed.
export interface OverviewAdjustments
  extends Omit<
    OverviewAdjustmentsSlice,
    | "reportedAumByAmcId"
    | "avgAumByAmcId"
    | "currentAvgAumByAmcId"
    | "histLiveAumByAmcId"
    | "indexAvgLevelByKey"
    | "indexCurrentAvgLevelByKey"
    | "indexHistLiveLevelByKey"
  > {
  reportedAumByAmcId: Record<number, number>;
  avgAumByAmcId: Record<number, AverageAumRange>;
  currentAvgAumByAmcId: Record<number, AverageAumRange>;
  histLiveAumByAmcId: Record<number, number>;
  indexAvgLevelByKey: Record<IndexKey, number | null>;
  indexCurrentAvgLevelByKey: Record<IndexKey, number | null>;
  indexHistLiveLevelByKey: Record<IndexKey, number | null>;
}

/**
 * The Overview table's three adjustable views, all pure historical-DB
 * lookups with no DHAN involvement at all: Reported AUM for an arbitrary
 * past period (amc_periods retains every imported month), and two
 * independent Avg AUM windows -- one defaulting to the previous fiscal
 * quarter ("Avg AUM"), one defaulting to the current fiscal quarter to date
 * ("Avg Live AUM", growing daily) -- both overridable to any custom range.
 * Deliberately kept independent of computeLiveAum -- none of these need a
 * fresh price, so this never triggers a DHAN call just because a month or
 * date range was changed.
 */
export async function getOverviewAdjustments(options?: {
  reportPeriod?: string;
  avgFrom?: string;
  avgTo?: string;
  currentAvgFrom?: string;
  currentAvgTo?: string;
  histLiveDate?: string;
  blendGoldSilverAmcIds?: number[];
  fields?: OverviewAdjustmentsField[];
}): Promise<OverviewAdjustmentsSlice> {
  const fieldSet = new Set(options?.fields ?? ALL_OVERVIEW_ADJUSTMENTS_FIELDS);
  const [currentReportPeriod, availableReportPeriods, bounds] = await Promise.all([
    getCurrentReportPeriod(),
    getAvailableReportPeriods(),
    getCanonicalSnapshotDateBounds(),
  ]);
  if (!currentReportPeriod) {
    throw new Error("No Excel file has been imported yet — upload one from /admin to get started.");
  }

  const reportPeriod =
    options?.reportPeriod && availableReportPeriods.includes(options.reportPeriod)
      ? options.reportPeriod
      : currentReportPeriod;

  const { minDate, maxDate } = bounds;
  const clamp = (d: string) => (minDate && maxDate ? (d < minDate ? minDate : d > maxDate ? maxDate : d) : d);
  const today = getIstDateString();

  const prevQuarter = getPreviousFiscalQuarterBounds(today);
  let avgFrom = options?.avgFrom ? clamp(options.avgFrom) : clamp(prevQuarter.start);
  let avgTo = options?.avgTo ? clamp(options.avgTo) : clamp(prevQuarter.end);
  if (avgFrom > avgTo) [avgFrom, avgTo] = [avgTo, avgFrom];

  const currentQuarter = getFiscalQuarterBounds(today);
  let currentAvgFrom = options?.currentAvgFrom ? clamp(options.currentAvgFrom) : clamp(currentQuarter.start);
  let currentAvgTo = options?.currentAvgTo ? clamp(options.currentAvgTo) : clamp(today);
  if (currentAvgFrom > currentAvgTo) [currentAvgFrom, currentAvgTo] = [currentAvgTo, currentAvgFrom];

  const histLiveDate = options?.histLiveDate ? clamp(options.histLiveDate) : clamp(prevQuarter.end);

  // Always anchored to the REAL current report period, never the possibly-
  // overridden `reportPeriod` above (picking an older "Reported AUM" month
  // from that picker shouldn't change what "today's still-open period"
  // means for flow adjustment) -- see the flow-estimate averages audit.
  // Only needed by avgAum/currentAvgAum, so only fetched when at least one
  // of those was actually requested.
  const flowCtx =
    fieldSet.has("avgAum") || fieldSet.has("currentAvgAum") ? await getFlowAdjustmentContext(currentReportPeriod) : null;

  const [reportedAumMap, avgAumMap, currentAvgAumMap, histLiveAumMap, indexAvgLevelByKey, indexCurrentAvgLevelByKey, indexHistLiveLevelByKey] =
    await Promise.all([
      fieldSet.has("reportedAum") ? getReportedAumForPeriod(reportPeriod) : Promise.resolve(null),
      fieldSet.has("avgAum") ? getAverageAumForRange(avgFrom, avgTo, flowCtx!, options?.blendGoldSilverAmcIds) : Promise.resolve(null),
      fieldSet.has("currentAvgAum")
        ? getAverageAumForRange(currentAvgFrom, currentAvgTo, flowCtx!, options?.blendGoldSilverAmcIds)
        : Promise.resolve(null),
      fieldSet.has("histLiveAum") ? getAllAmcsLiveAumAsOf(histLiveDate, options?.blendGoldSilverAmcIds) : Promise.resolve(null),
      fieldSet.has("indexAvg") ? getAverageIndexLevelForRange(avgFrom, avgTo) : Promise.resolve(null),
      fieldSet.has("indexCurrentAvg") ? getAverageIndexLevelForRange(currentAvgFrom, currentAvgTo) : Promise.resolve(null),
      fieldSet.has("indexHistLive") ? getIndexLevelsAsOf(histLiveDate) : Promise.resolve(null),
    ]);

  return {
    reportPeriod,
    availableReportPeriods,
    reportedAumByAmcId: reportedAumMap ? Object.fromEntries(reportedAumMap) : undefined,
    avgFrom,
    avgTo,
    avgAumByAmcId: avgAumMap ? Object.fromEntries(avgAumMap) : undefined,
    currentAvgFrom,
    currentAvgTo,
    currentAvgAumByAmcId: currentAvgAumMap ? Object.fromEntries(currentAvgAumMap) : undefined,
    minSnapshotDate: minDate,
    maxSnapshotDate: maxDate,
    histLiveDate,
    histLiveAumByAmcId: histLiveAumMap
      ? Object.fromEntries([...histLiveAumMap].map(([amcId, v]) => [amcId, v.liveAumCr]))
      : undefined,
    indexAvgLevelByKey: indexAvgLevelByKey ?? undefined,
    indexCurrentAvgLevelByKey: indexCurrentAvgLevelByKey ?? undefined,
    indexHistLiveLevelByKey: indexHistLiveLevelByKey ?? undefined,
  };
}
