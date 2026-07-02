import { asc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { liveAumDailySnapshot } from "../db/schema";
import { firstDayOfNextMonth } from "./report-period";

export interface AumHistoryPoint {
  date: string;
  liveAumCr: number;
  reportedAumCr: number;
}

export async function getAmcAumHistory(amcId: number): Promise<AumHistoryPoint[]> {
  const rows = await db
    .select()
    .from(liveAumDailySnapshot)
    .where(eq(liveAumDailySnapshot.amcId, amcId))
    .orderBy(asc(liveAumDailySnapshot.snapshotDate));

  return rows.map((r) => ({
    date: r.snapshotDate,
    liveAumCr: Number(r.liveAumCr),
    reportedAumCr: Number(r.reportedAumCr),
  }));
}

export interface AverageAumSinceReport {
  avgLiveAumCr: number;
  daysCount: number;
  windowStart: string;
}

/**
 * Average of daily live-AUM snapshots since the window opened by the current
 * report period (1st of the month after it) through however many days have
 * actually been captured so far — the "avg AUM this period" column. Keyed by
 * amcId; AMCs with zero snapshots in the window are simply absent from the map.
 */
export async function getAverageAumSinceReport(reportPeriod: string): Promise<Map<number, AverageAumSinceReport>> {
  const windowStart = firstDayOfNextMonth(reportPeriod);

  const rows = await db
    .select({
      amcId: liveAumDailySnapshot.amcId,
      avgLiveAumCr: sql<number>`avg(${liveAumDailySnapshot.liveAumCr})::float`,
      daysCount: sql<number>`count(*)::int`,
    })
    .from(liveAumDailySnapshot)
    .where(gte(liveAumDailySnapshot.snapshotDate, windowStart))
    .groupBy(liveAumDailySnapshot.amcId);

  const map = new Map<number, AverageAumSinceReport>();
  for (const r of rows) {
    map.set(r.amcId, { avgLiveAumCr: r.avgLiveAumCr, daysCount: r.daysCount, windowStart });
  }
  return map;
}

export async function getIndustryAumHistory(): Promise<AumHistoryPoint[]> {
  const rows = await db
    .select({
      date: liveAumDailySnapshot.snapshotDate,
      liveAumCr: sql<number>`sum(${liveAumDailySnapshot.liveAumCr})::float`,
      reportedAumCr: sql<number>`sum(${liveAumDailySnapshot.reportedAumCr})::float`,
    })
    .from(liveAumDailySnapshot)
    .groupBy(liveAumDailySnapshot.snapshotDate)
    .orderBy(asc(liveAumDailySnapshot.snapshotDate));

  return rows;
}
