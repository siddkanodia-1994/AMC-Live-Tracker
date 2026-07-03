import { asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { isinDailyPrice, liveAumDailySnapshot } from "../db/schema";
import { getIstDateString } from "../utils/date";
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

export interface PreviousDayAum {
  liveAumCr: number;
  snapshotDate: string;
}

/**
 * Each AMC's most recent snapshot strictly before today (IST), regardless of
 * how many days back that is — used for the "1 Day Change %" column. A gap
 * in daily collection just means the comparison silently spans more than one
 * day rather than being blank; AMCs with no snapshot at all are absent from
 * the map.
 */
export async function getPreviousDayLiveAum(): Promise<Map<number, PreviousDayAum>> {
  const today = getIstDateString();

  const rows = await db
    .select({
      amcId: liveAumDailySnapshot.amcId,
      snapshotDate: liveAumDailySnapshot.snapshotDate,
      liveAumCr: liveAumDailySnapshot.liveAumCr,
    })
    .from(liveAumDailySnapshot)
    .where(lt(liveAumDailySnapshot.snapshotDate, today))
    .orderBy(desc(liveAumDailySnapshot.snapshotDate));

  const map = new Map<number, PreviousDayAum>();
  for (const r of rows) {
    if (!map.has(r.amcId)) {
      map.set(r.amcId, { liveAumCr: Number(r.liveAumCr), snapshotDate: r.snapshotDate });
    }
  }
  return map;
}

/**
 * Each priced ISIN's most recent stored price strictly before today (IST) —
 * the per-holding sibling of getPreviousDayLiveAum, keyed by ISIN rather than
 * amcId since price is a security-level fact shared across every AMC holding
 * it (one row instead of one per AMC). Same "most recent regardless of gap"
 * semantics; ISINs never priced before are simply absent from the map.
 */
export async function getPreviousDayIsinPrices(): Promise<Map<string, number>> {
  const today = getIstDateString();

  const rows = await db
    .select({
      isin: isinDailyPrice.isin,
      snapshotDate: isinDailyPrice.snapshotDate,
      priceInr: isinDailyPrice.priceInr,
    })
    .from(isinDailyPrice)
    .where(lt(isinDailyPrice.snapshotDate, today))
    .orderBy(desc(isinDailyPrice.snapshotDate));

  const map = new Map<string, number>();
  for (const r of rows) {
    if (!map.has(r.isin)) {
      map.set(r.isin, Number(r.priceInr));
    }
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
