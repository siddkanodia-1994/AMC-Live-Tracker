import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { isinDailyPrice } from "../db/schema";

export interface IsinDailyPriceRow {
  isin: string;
  snapshotDate: string;
  priceInr: number;
}

/**
 * Bulk-upserts arbitrary (isin, date, price) rows into isin_daily_price --
 * shared by the live compute path (today's date, compute-live-aum.ts), the
 * historical backfill (many dates at once, backfill.ts), and the foreign
 * price refresh (yesterday's close from Finnhub's free "previous close"
 * field, foreign-pricing.ts). Kept in its own module rather than inside
 * compute-live-aum.ts to avoid a circular import -- compute-live-aum.ts
 * itself imports from foreign-pricing.ts.
 */
export async function writeIsinDailyPriceRows(rows: IsinDailyPriceRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
        isin: r.isin,
        snapshotDate: r.snapshotDate,
        priceInr: String(r.priceInr),
      }));
      await db
        .insert(isinDailyPrice)
        .values(batch)
        .onConflictDoUpdate({
          target: [isinDailyPrice.isin, isinDailyPrice.snapshotDate],
          set: {
            priceInr: sql`excluded.price_inr`,
            computedAt: sql`now()`,
          },
        });
    }
  } catch (err) {
    console.error("Failed to write daily ISIN prices:", err);
  }
}
