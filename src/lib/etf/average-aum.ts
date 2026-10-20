import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { amcs, etfDailyAumEstimate, etfSchemes } from "../db/schema";
import { getFiscalQuarterBounds, getPreviousFiscalQuarterBounds } from "../aum/report-period";
import { getIstDateString } from "../utils/date";
import { getEtfCombinedDailySeriesBySchemeIds } from "./daily-series";

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

/**
 * Each requested equity amcId's combined Gold+Silver daily AUM, keyed by
 * date -- the primitive behind "blend Gold/Silver into this AMC's Equity
 * AUM" (the Overview/Correlation/Fortnightly tabs' toggle). Matches an
 * equity AMC to its Gold/Silver schemes by name (`etfSchemes.amc ===
 * amcs.overviewName`), the same convention already used everywhere this
 * app cross-references the two sides of the business. An AMC with no
 * Gold/Silver scheme, or a day outside that scheme's own data, simply has
 * no entry for that date -- callers should treat a missing day as +0
 * (equity-only fallback), never as an error.
 */
export async function getEtfDailyAumByAmcIds(amcIds: number[], startDate: string, endDate: string): Promise<Map<number, Map<string, number>>> {
  const result = new Map<number, Map<string, number>>();
  if (amcIds.length === 0) return result;

  const amcRows = await db.select({ id: amcs.id, overviewName: amcs.overviewName }).from(amcs).where(inArray(amcs.id, amcIds));
  if (amcRows.length === 0) return result;

  const overviewNames = amcRows.map((a) => a.overviewName);
  const schemeRows = await db
    .select({ id: etfSchemes.id, amc: etfSchemes.amc })
    .from(etfSchemes)
    .where(inArray(etfSchemes.amc, overviewNames));
  if (schemeRows.length === 0) return result;

  const schemeIdsByOverviewName = new Map<string, number[]>();
  for (const s of schemeRows) {
    if (!schemeIdsByOverviewName.has(s.amc)) schemeIdsByOverviewName.set(s.amc, []);
    schemeIdsByOverviewName.get(s.amc)!.push(s.id);
  }

  const allSchemeIds = schemeRows.map((s) => s.id);
  const seriesBySchemeId = await getEtfCombinedDailySeriesBySchemeIds(allSchemeIds, startDate, endDate);

  for (const amc of amcRows) {
    const schemeIds = schemeIdsByOverviewName.get(amc.overviewName);
    if (!schemeIds || schemeIds.length === 0) continue;
    const dailyTotals = new Map<string, number>();
    for (const schemeId of schemeIds) {
      for (const point of seriesBySchemeId.get(schemeId) ?? []) {
        dailyTotals.set(point.date, (dailyTotals.get(point.date) ?? 0) + point.aum);
      }
    }
    result.set(amc.id, dailyTotals);
  }

  return result;
}
