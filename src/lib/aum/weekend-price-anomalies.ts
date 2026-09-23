import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { amcHistoricalAumEstimate, amcListedStock, amcs, isinDailyPrice, liveAumDailySnapshot } from "../db/schema";

export interface WeekendPriceAnomaly {
  isin: string;
  overviewName: string;
  snapshotDate: string;
  priceInr: number;
}

/**
 * Flags any isin_daily_price row, for one of the 8 amc_listed_stock ISINs,
 * dated a Saturday or Sunday with NO matching AUM entry for that same
 * AMC+date -- checked against BOTH amc_historical_aum_estimate (the
 * 2023-2025 index-return-based backfill) and live_aum_daily_snapshot (real
 * daily ingestion from whenever that started), mirroring exactly how
 * getAumHistoryForAmcIds (history.ts) combines the two into the one AUM
 * series the app actually displays -- checking live_aum_daily_snapshot
 * alone would false-positive on every real weekend session that falls in
 * the pre-live-ingestion backfill period. Also matches getAumHistoryForAmcIds'
 * own isCanonical = true filter on live_aum_daily_snapshot -- a
 * non-canonical row can exist for a non-trading day (confirmed: the same
 * 2026-09-19 stray-price incident also left a non-canonical live AUM row
 * behind) without the app ever treating that date as real, so a raw
 * "does any row exist" check would silently miss exactly the case this
 * function exists to catch. The historical backfill only ever produces a
 * value for a day NIFTY 500 itself traded, so a genuine special trading
 * session (Budget day, Diwali Muhurat, a SEBI DR-site test) always has a
 * matching AUM row in one of the two -- confirmed against all 6 real
 * weekend sessions in this app's history (2026-09 audit). This only
 * catches the other case: a stray/duplicate price row on a day nothing
 * else recognizes as a trading day, like the 2026-09-19 stale-Friday-close
 * duplicate that audit found and fixed (its origin was never conclusively
 * identified).
 */
export async function getWeekendPriceAnomalies(): Promise<WeekendPriceAnomaly[]> {
  const stocks = await db.select({ isin: amcListedStock.isin, amcId: amcListedStock.amcId }).from(amcListedStock);
  if (stocks.length === 0) return [];
  const isins = stocks.map((s) => s.isin);
  const amcIdByIsin = new Map(stocks.map((s) => [s.isin, s.amcId]));

  const weekendRows = await db
    .select({ isin: isinDailyPrice.isin, snapshotDate: isinDailyPrice.snapshotDate, priceInr: isinDailyPrice.priceInr })
    .from(isinDailyPrice)
    .where(and(inArray(isinDailyPrice.isin, isins), sql`extract(dow from ${isinDailyPrice.snapshotDate}) in (0, 6)`));
  if (weekendRows.length === 0) return [];

  const amcIds = [...new Set(amcIdByIsin.values())];
  const weekendDates = [...new Set(weekendRows.map((r) => r.snapshotDate))];
  const [liveAumRows, estimateAumRows] = await Promise.all([
    db
      .select({ amcId: liveAumDailySnapshot.amcId, snapshotDate: liveAumDailySnapshot.snapshotDate })
      .from(liveAumDailySnapshot)
      .where(
        and(
          inArray(liveAumDailySnapshot.amcId, amcIds),
          inArray(liveAumDailySnapshot.snapshotDate, weekendDates),
          eq(liveAumDailySnapshot.isCanonical, true)
        )
      ),
    db
      .select({ amcId: amcHistoricalAumEstimate.amcId, snapshotDate: amcHistoricalAumEstimate.snapshotDate })
      .from(amcHistoricalAumEstimate)
      .where(and(inArray(amcHistoricalAumEstimate.amcId, amcIds), inArray(amcHistoricalAumEstimate.snapshotDate, weekendDates))),
  ]);
  const aumKeys = new Set([...liveAumRows, ...estimateAumRows].map((r) => `${r.amcId}|${r.snapshotDate}`));

  const amcRows = await db.select({ id: amcs.id, overviewName: amcs.overviewName }).from(amcs);
  const nameById = new Map(amcRows.map((a) => [a.id, a.overviewName]));

  const anomalies: WeekendPriceAnomaly[] = [];
  for (const row of weekendRows) {
    const amcId = amcIdByIsin.get(row.isin)!;
    if (!aumKeys.has(`${amcId}|${row.snapshotDate}`)) {
      anomalies.push({
        isin: row.isin,
        overviewName: nameById.get(amcId) ?? row.isin,
        snapshotDate: row.snapshotDate,
        priceInr: Number(row.priceInr),
      });
    }
  }
  return anomalies.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
}
