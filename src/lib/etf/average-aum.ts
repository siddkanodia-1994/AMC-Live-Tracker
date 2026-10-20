import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { etfDailyAumEstimate } from "../db/schema";
import { getFiscalQuarterBounds, getPreviousFiscalQuarterBounds } from "../aum/report-period";
import { getIstDateString } from "../utils/date";

export interface EtfAverageAumRange {
  avgAumCr: number;
  daysCount: number;
}

/**
 * Mean estimatedAumCr per scheme over [startDate, endDate] -- the Gold/
 * Silver analogue of src/lib/aum/history.ts's getAverageAumForRange, same
 * plain SQL AVG()/COUNT() shape, grouped by schemeId instead of amcId and
 * reading etf_daily_aum_estimate instead of live_aum_daily_snapshot. No
 * flow-adjustment parameter: unlike the equity side's flat "Est. Net Flow"
 * add-on for an still-open reporting gap, this series already has investor
 * flow baked into every day's estimatedAumCr via the Modified-Dietz
 * reconciliation (see src/lib/etf/historical-backfill.ts), so there's
 * nothing further to layer on here.
 */
export async function getEtfAverageAumForRange(startDate: string, endDate: string): Promise<Map<number, EtfAverageAumRange>> {
  const rows = await db
    .select({
      schemeId: etfDailyAumEstimate.schemeId,
      avgAumCr: sql<number>`avg(${etfDailyAumEstimate.estimatedAumCr})::float`,
      daysCount: sql<number>`count(*)::int`,
    })
    .from(etfDailyAumEstimate)
    .where(and(gte(etfDailyAumEstimate.snapshotDate, startDate), lte(etfDailyAumEstimate.snapshotDate, endDate)))
    .groupBy(etfDailyAumEstimate.schemeId);

  const map = new Map<number, EtfAverageAumRange>();
  for (const r of rows) map.set(r.schemeId, { avgAumCr: r.avgAumCr, daysCount: r.daysCount });
  return map;
}

export interface EtfAverageAumSummary {
  avgFrom: string;
  avgTo: string;
  currentAvgFrom: string;
  currentAvgTo: string;
  avgAumByScheme: Record<number, EtfAverageAumRange>; // prior fiscal quarter
  currentAvgAumByScheme: Record<number, EtfAverageAumRange>; // current fiscal quarter-to-date
}

/**
 * Both average-AUM windows the Gold & Silver ETF tab shows, mirroring the
 * Overview table's own "Avg AUM" (prior fiscal quarter) / "Avg Live AUM"
 * (current fiscal quarter-to-date) column pair exactly -- same
 * getFiscalQuarterBounds/getPreviousFiscalQuarterBounds helpers, so the
 * window boundaries are identical across both tabs.
 */
export async function getEtfAverageAumSummary(): Promise<EtfAverageAumSummary> {
  const today = getIstDateString();
  const prevQuarter = getPreviousFiscalQuarterBounds(today);
  const currentQuarter = getFiscalQuarterBounds(today);

  const [avgAumMap, currentAvgAumMap] = await Promise.all([
    getEtfAverageAumForRange(prevQuarter.start, prevQuarter.end),
    getEtfAverageAumForRange(currentQuarter.start, today),
  ]);

  return {
    avgFrom: prevQuarter.start,
    avgTo: prevQuarter.end,
    currentAvgFrom: currentQuarter.start,
    currentAvgTo: today,
    avgAumByScheme: Object.fromEntries(avgAumMap),
    currentAvgAumByScheme: Object.fromEntries(currentAvgAumMap),
  };
}
