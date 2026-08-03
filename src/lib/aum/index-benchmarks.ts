import { and, avg, count, desc, eq, gte, lt, lte } from "drizzle-orm";
import { db } from "../db/client";
import { indexDailyLevel } from "../db/schema";
import { fetchLtps } from "../dhan/client";
import { INDEX_KEYS, INDEX_SECURITY_IDS, type IndexKey } from "../dhan/indices";
import { getIstDateString } from "../utils/date";
import { writeIndexDailyLevelRows } from "./index-level-store";

export interface IndexLiveLevel {
  liveLevelValue: number | null;
  oneDayChangePct: number | null;
}

/**
 * Fetches live LTPs for NIFTY 50 / NIFTY 500 via DHAN and writes today's row
 * into index_daily_level (same overwrite-today's-row pattern the AMC live
 * path already uses for isin_daily_price/live_aum_daily_snapshot). Called
 * once per /api/live-aum request, in parallel with computeLiveAum -- never
 * from inside that file, which stays untouched.
 */
export async function refreshLiveIndexLevels(): Promise<Record<IndexKey, IndexLiveLevel>> {
  const today = getIstDateString();
  const result = Object.fromEntries(
    INDEX_KEYS.map((key) => [key, { liveLevelValue: null, oneDayChangePct: null }])
  ) as Record<IndexKey, IndexLiveLevel>;

  try {
    const ltpResult = await fetchLtps(
      INDEX_KEYS.map((key) => ({ exchangeSegment: "IDX_I" as const, securityId: INDEX_SECURITY_IDS[key] }))
    );

    const rowsToWrite: { indexKey: IndexKey; snapshotDate: string; levelValue: number }[] = [];
    for (const key of INDEX_KEYS) {
      const price = ltpResult.pricesBySecurityId.get(`IDX_I:${INDEX_SECURITY_IDS[key]}`);
      if (price != null) {
        result[key].liveLevelValue = price;
        rowsToWrite.push({ indexKey: key, snapshotDate: today, levelValue: price });
      }
    }
    if (rowsToWrite.length > 0) await writeIndexDailyLevelRows(rowsToWrite);

    for (const key of INDEX_KEYS) {
      if (result[key].liveLevelValue === null) continue;
      const [priorRow] = await db
        .select({ levelValue: indexDailyLevel.levelValue })
        .from(indexDailyLevel)
        .where(and(eq(indexDailyLevel.indexKey, key), lt(indexDailyLevel.snapshotDate, today)))
        .orderBy(desc(indexDailyLevel.snapshotDate))
        .limit(1);
      if (priorRow) {
        const prior = Number(priorRow.levelValue);
        result[key].oneDayChangePct = prior !== 0 ? result[key].liveLevelValue! / prior - 1 : null;
      }
    }
  } catch (err) {
    console.error("Failed to refresh live index levels:", err);
  }

  return result;
}

/** Avg index level over [startDate, endDate] -- mirrors getAverageAumForRange. */
export async function getAverageIndexLevelForRange(
  startDate: string,
  endDate: string
): Promise<Record<IndexKey, number | null>> {
  const rows = await db
    .select({
      indexKey: indexDailyLevel.indexKey,
      avgLevel: avg(indexDailyLevel.levelValue),
      daysCount: count(),
    })
    .from(indexDailyLevel)
    .where(and(gte(indexDailyLevel.snapshotDate, startDate), lte(indexDailyLevel.snapshotDate, endDate)))
    .groupBy(indexDailyLevel.indexKey);

  const result = Object.fromEntries(INDEX_KEYS.map((key) => [key, null])) as Record<IndexKey, number | null>;
  for (const r of rows) {
    if (INDEX_KEYS.includes(r.indexKey as IndexKey) && r.avgLevel !== null) {
      result[r.indexKey as IndexKey] = Number(r.avgLevel);
    }
  }
  return result;
}

/** Index level as of the closest date at or before `date` -- mirrors getAllAmcsLiveAumAsOf. */
export async function getIndexLevelsAsOf(date: string): Promise<Record<IndexKey, number | null>> {
  const result = Object.fromEntries(INDEX_KEYS.map((key) => [key, null])) as Record<IndexKey, number | null>;
  for (const key of INDEX_KEYS) {
    const [row] = await db
      .select({ levelValue: indexDailyLevel.levelValue })
      .from(indexDailyLevel)
      .where(and(eq(indexDailyLevel.indexKey, key), lte(indexDailyLevel.snapshotDate, date)))
      .orderBy(desc(indexDailyLevel.snapshotDate))
      .limit(1);
    if (row) result[key] = Number(row.levelValue);
  }
  return result;
}
