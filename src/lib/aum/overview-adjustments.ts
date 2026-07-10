import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings } from "../db/schema";
import { getIstDateString } from "../utils/date";
import { getAvailableReportPeriods } from "./aum-growth";
import { getAverageAumForRange, getCanonicalSnapshotDateBounds, getReportedAumForPeriod } from "./history";
import { firstDayOfNextMonth } from "./report-period";

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
  minSnapshotDate: string | null;
  maxSnapshotDate: string | null;
}

/**
 * The Overview table's two adjustable views, both pure historical-DB lookups
 * with no DHAN involvement at all: Reported AUM for an arbitrary past period
 * (amc_periods retains every imported month), and Avg AUM over an arbitrary
 * custom date range instead of the default "since report period end through
 * today" window. Deliberately kept independent of computeLiveAum -- neither
 * needs a fresh price, so this never triggers a DHAN call just because a
 * month or date range was changed.
 */
export async function getOverviewAdjustments(options?: {
  reportPeriod?: string;
  avgFrom?: string;
  avgTo?: string;
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

  let avgFrom = options?.avgFrom ? clamp(options.avgFrom) : firstDayOfNextMonth(currentReportPeriod);
  let avgTo = options?.avgTo ? clamp(options.avgTo) : getIstDateString();
  if (avgFrom > avgTo) [avgFrom, avgTo] = [avgTo, avgFrom];

  const [reportedAumMap, avgAumMap] = await Promise.all([
    getReportedAumForPeriod(reportPeriod),
    getAverageAumForRange(avgFrom, avgTo),
  ]);

  return {
    reportPeriod,
    availableReportPeriods,
    reportedAumByAmcId: Object.fromEntries(reportedAumMap),
    avgFrom,
    avgTo,
    avgAumByAmcId: Object.fromEntries(avgAumMap),
    minSnapshotDate: minDate,
    maxSnapshotDate: maxDate,
  };
}
