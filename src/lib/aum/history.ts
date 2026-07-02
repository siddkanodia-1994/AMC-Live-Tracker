import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { liveAumDailySnapshot } from "../db/schema";

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
