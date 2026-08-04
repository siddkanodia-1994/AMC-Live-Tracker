import { and, avg, count, desc, eq, gte, lt, lte } from "drizzle-orm";
import { db } from "../db/client";
import { indexDailyLevel } from "../db/schema";
import { INDEX_KEYS, type IndexKey } from "../dhan/indices";

export interface IndexLiveLevel {
  liveLevelValue: number | null;
  oneDayChangePct: number | null;
}

/**
 * Most recent index_daily_level row strictly BEFORE `beforeDate`, per
 * index -- used by compute-live-aum.ts to compute the index rows' 1D
 * change. Strict `lt` (not `lte`) is deliberate: this may be called
 * before or after today's own row has been written in the same run, and
 * `lt` can never accidentally match a row this same run just wrote.
 */
export async function getPreviousIndexLevels(beforeDate: string): Promise<Record<IndexKey, number | null>> {
  const result = Object.fromEntries(INDEX_KEYS.map((key) => [key, null])) as Record<IndexKey, number | null>;
  for (const key of INDEX_KEYS) {
    const [row] = await db
      .select({ levelValue: indexDailyLevel.levelValue })
      .from(indexDailyLevel)
      .where(and(eq(indexDailyLevel.indexKey, key), lt(indexDailyLevel.snapshotDate, beforeDate)))
      .orderBy(desc(indexDailyLevel.snapshotDate))
      .limit(1);
    if (row) result[key] = Number(row.levelValue);
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
