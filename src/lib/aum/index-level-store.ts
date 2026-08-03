import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { indexDailyLevel } from "../db/schema";
import type { IndexKey } from "../dhan/indices";

export interface IndexDailyLevelRow {
  indexKey: IndexKey;
  snapshotDate: string;
  levelValue: number;
}

/**
 * Bulk-upserts (indexKey, date, level) rows into index_daily_level --
 * shared by the one-time historical backfill (many dates at once) and the
 * live poll (today's date, written on every /api/live-aum call), same
 * overwrite-today's-row pattern as writeIsinDailyPriceRows.
 */
export async function writeIndexDailyLevelRows(rows: IndexDailyLevelRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
        indexKey: r.indexKey,
        snapshotDate: r.snapshotDate,
        levelValue: String(r.levelValue),
      }));
      await db
        .insert(indexDailyLevel)
        .values(batch)
        .onConflictDoUpdate({
          target: [indexDailyLevel.indexKey, indexDailyLevel.snapshotDate],
          set: {
            levelValue: sql`excluded.level_value`,
            computedAt: sql`now()`,
          },
        });
    }
  } catch (err) {
    console.error("Failed to write daily index levels:", err);
  }
}
