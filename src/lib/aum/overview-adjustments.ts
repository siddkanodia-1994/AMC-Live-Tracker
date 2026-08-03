import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings } from "../db/schema";
import type { IndexKey } from "../dhan/indices";
import { getIstDateString } from "../utils/date";
import { getAvailableReportPeriods } from "./aum-growth";
import { getAllAmcsLiveAumAsOf, getAverageAumForRange, getCanonicalSnapshotDateBounds, getReportedAumForPeriod } from "./history";
import { getAverageIndexLevelForRange, getIndexLevelsAsOf } from "./index-benchmarks";
import { getFiscalQuarterBounds, getPreviousFiscalQuarterBounds } from "./report-period";

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";

async function getCurrentReportPeriod(): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, CURRENT_REPORT_PERIOD_KEY));
  return row?.value ?? null;
}

export interface OverviewAdjustments {
  reportPeriod: string;
  availableReportPeriods: string[];
  reportedAumByAmcId: Record<number, number>;
  avgFrom: string;
  avgTo: string;
  avgAumByAmcId: Record<number, { avgLiveAumCr: number; daysCount: number }>;
  currentAvgFrom: string;
  currentAvgTo: string;
  currentAvgAumByAmcId: Record<number, { avgLiveAumCr: number; daysCount: number }>;
  minSnapshotDate: string | null;
  maxSnapshotDate: string | null;
  // The Overview table's "Hist. Live AUM" toggle mode -- each AMC's live
  // (repriced) AUM as of an arbitrary past date, an alternative to
  // reportedAumByAmcId above. Defaults to the last day of the most
  // recently completed FISCAL QUARTER when not explicitly requested (same
  // prevQuarter used for the "Avg AUM" window default above) -- so it only
  // advances at quarter boundaries, not every month.
  histLiveDate: string;
  histLiveAumByAmcId: Record<number, number>;
  // Same three windows/date above, applied to the Overview table's Nifty
  // 50/Nifty 500 benchmark rows instead of AMCs -- kept in lockstep with
  // the AMC figures (same avgFrom/avgTo/currentAvgFrom/currentAvgTo/
  // histLiveDate) so picking a custom window updates both together.
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
}): Promise<OverviewAdjustments> {
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

  const [reportedAumMap, avgAumMap, currentAvgAumMap, histLiveAumMap, indexAvgLevelByKey, indexCurrentAvgLevelByKey, indexHistLiveLevelByKey] =
    await Promise.all([
      getReportedAumForPeriod(reportPeriod),
      getAverageAumForRange(avgFrom, avgTo),
      getAverageAumForRange(currentAvgFrom, currentAvgTo),
      getAllAmcsLiveAumAsOf(histLiveDate),
      getAverageIndexLevelForRange(avgFrom, avgTo),
      getAverageIndexLevelForRange(currentAvgFrom, currentAvgTo),
      getIndexLevelsAsOf(histLiveDate),
    ]);

  return {
    reportPeriod,
    availableReportPeriods,
    reportedAumByAmcId: Object.fromEntries(reportedAumMap),
    avgFrom,
    avgTo,
    avgAumByAmcId: Object.fromEntries(avgAumMap),
    currentAvgFrom,
    currentAvgTo,
    currentAvgAumByAmcId: Object.fromEntries(currentAvgAumMap),
    minSnapshotDate: minDate,
    maxSnapshotDate: maxDate,
    histLiveDate,
    histLiveAumByAmcId: Object.fromEntries([...histLiveAumMap].map(([amcId, v]) => [amcId, v.liveAumCr])),
    indexAvgLevelByKey,
    indexCurrentAvgLevelByKey,
    indexHistLiveLevelByKey,
  };
}
