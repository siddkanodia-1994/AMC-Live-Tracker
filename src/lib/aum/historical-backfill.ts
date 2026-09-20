import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { amcHistoricalAumAnchor, amcHistoricalAumEstimate, amcListedStock, indexDailyLevel, isinDailyPrice } from "../db/schema";

const NIFTY_500 = "NIFTY_500";
const BATCH_SIZE = 500;

/**
 * The last date on/before `calendarMonthEnd` that has a NIFTY_500 row --
 * index_daily_level only has rows for real trading days, so this doubles
 * as "the last actual NSE trading day of that month" without needing a
 * 2023-2025 holiday list (which doesn't exist in this codebase; see the
 * historical-backfill plan's audit of market-hours.ts).
 */
export async function resolveMonthEndTradingDate(calendarMonthEnd: string): Promise<string> {
  const [row] = await db
    .select({ snapshotDate: indexDailyLevel.snapshotDate })
    .from(indexDailyLevel)
    .where(and(eq(indexDailyLevel.indexKey, NIFTY_500), lte(indexDailyLevel.snapshotDate, calendarMonthEnd)))
    .orderBy(sql`${indexDailyLevel.snapshotDate} desc`)
    .limit(1);
  if (!row) throw new Error(`No NIFTY_500 index_daily_level row on or before ${calendarMonthEnd}`);
  return row.snapshotDate;
}

export interface HistoricalBackfillResult {
  amcId: number;
  anchorsUsed: number;
  segmentsComputed: number;
  rowsWritten: number;
  firstWrittenDate: string | null;
  lastWrittenDate: string | null;
  priceFloorDate: string | null;
  warnings: string[];
}

/**
 * Computes and upserts amc_historical_aum_estimate for one AMC, bridging
 * its amc_historical_aum_anchor monthly points with NIFTY_500's daily
 * return (compounded forward each month, then multiplicatively ramped so
 * the month lands exactly on the next anchor -- see the plan's algorithm
 * writeup). Rows are truncated to this AMC's own earliest isin_daily_price
 * date: if that AMC's own stock listed later than some anchors, earlier
 * months are used only to seed the compounding chain, never written as
 * output (per explicit user decision -- don't store AUM for a stretch
 * that has no share price to ever compare it against).
 *
 * Ordering dependency: the AMC's historical share price data must already
 * be ingested (isin_daily_price) before this runs, since the price floor
 * is read from real data, not a config value. If none is found yet, this
 * AMC is skipped entirely (returns rowsWritten: 0) rather than guessing.
 */
export async function computeHistoricalAumEstimates(amcId: number): Promise<HistoricalBackfillResult> {
  const warnings: string[] = [];
  const anchors = await db
    .select()
    .from(amcHistoricalAumAnchor)
    .where(eq(amcHistoricalAumAnchor.amcId, amcId))
    .orderBy(asc(amcHistoricalAumAnchor.monthEndDate));

  if (anchors.length < 2) {
    warnings.push(`Only ${anchors.length} anchor(s) found -- need at least 2 to compound between.`);
    return { amcId, anchorsUsed: anchors.length, segmentsComputed: 0, rowsWritten: 0, firstWrittenDate: null, lastWrittenDate: null, priceFloorDate: null, warnings };
  }

  const [listedStock] = await db.select({ isin: amcListedStock.isin }).from(amcListedStock).where(eq(amcListedStock.amcId, amcId));
  if (!listedStock) {
    warnings.push("No amc_listed_stock row for this AMC -- skipped (no share price to ever truncate against).");
    return { amcId, anchorsUsed: anchors.length, segmentsComputed: 0, rowsWritten: 0, firstWrittenDate: null, lastWrittenDate: null, priceFloorDate: null, warnings };
  }

  const [earliestPrice] = await db
    .select({ snapshotDate: isinDailyPrice.snapshotDate })
    .from(isinDailyPrice)
    .where(eq(isinDailyPrice.isin, listedStock.isin))
    .orderBy(asc(isinDailyPrice.snapshotDate))
    .limit(1);

  if (!earliestPrice) {
    warnings.push("No isin_daily_price rows yet for this AMC's own stock -- skipped. Ingest share price data first.");
    return { amcId, anchorsUsed: anchors.length, segmentsComputed: 0, rowsWritten: 0, firstWrittenDate: null, lastWrittenDate: null, priceFloorDate: null, warnings };
  }
  const priceFloorDate = earliestPrice.snapshotDate;

  const rowsToWrite: (typeof amcHistoricalAumEstimate.$inferInsert)[] = [];
  let segmentsComputed = 0;

  for (let i = 0; i < anchors.length - 1; i++) {
    const start = anchors[i];
    const end = anchors[i + 1];
    const startDate = start.monthEndDate;
    const endDate = end.monthEndDate;
    const startAum = Number(start.exitAumCr);
    const endAum = Number(end.exitAumCr);

    const levels = await db
      .select({ snapshotDate: indexDailyLevel.snapshotDate, levelValue: indexDailyLevel.levelValue })
      .from(indexDailyLevel)
      .where(and(eq(indexDailyLevel.indexKey, NIFTY_500), gte(indexDailyLevel.snapshotDate, startDate), lte(indexDailyLevel.snapshotDate, endDate)))
      .orderBy(asc(indexDailyLevel.snapshotDate));

    if (levels.length < 2 || levels[0].snapshotDate !== startDate || levels[levels.length - 1].snapshotDate !== endDate) {
      warnings.push(`Segment ${start.reportMonth}->${end.reportMonth}: missing/misaligned NIFTY_500 rows -- skipped.`);
      continue;
    }

    const tradingDays = levels.slice(1);
    const n = tradingDays.length;
    let rawCompounded = startAum;
    const rawSeries: { date: string; raw: number }[] = [];
    for (let j = 0; j < n; j++) {
      const prevLevel = Number(levels[j].levelValue);
      const currLevel = Number(tradingDays[j].levelValue);
      rawCompounded = rawCompounded * (currLevel / prevLevel);
      rawSeries.push({ date: tradingDays[j].snapshotDate, raw: rawCompounded });
    }

    const rawFinal = rawSeries[n - 1].raw;
    const scaleFactorFinal = endAum / rawFinal;

    for (let j = 0; j < n; j++) {
      const position = j + 1; // 1-indexed; position === n is endDate itself
      const scale = 1 + (scaleFactorFinal - 1) * (position / n);
      const date = rawSeries[j].date;
      if (date < priceFloorDate) continue; // truncate: no share price to compare against yet

      rowsToWrite.push({
        amcId,
        snapshotDate: date,
        estimatedAumCr: String(rawSeries[j].raw * scale),
        rawCompoundedAumCr: String(rawSeries[j].raw),
        anchorMonthEndDate: endDate,
      });
    }
    segmentsComputed++;
  }

  for (let i = 0; i < rowsToWrite.length; i += BATCH_SIZE) {
    const batch = rowsToWrite.slice(i, i + BATCH_SIZE);
    await db
      .insert(amcHistoricalAumEstimate)
      .values(batch)
      .onConflictDoUpdate({
        target: [amcHistoricalAumEstimate.amcId, amcHistoricalAumEstimate.snapshotDate],
        set: {
          estimatedAumCr: sql`excluded.estimated_aum_cr`,
          rawCompoundedAumCr: sql`excluded.raw_compounded_aum_cr`,
          anchorMonthEndDate: sql`excluded.anchor_month_end_date`,
          computedAt: sql`now()`,
        },
      });
  }

  return {
    amcId,
    anchorsUsed: anchors.length,
    segmentsComputed,
    rowsWritten: rowsToWrite.length,
    firstWrittenDate: rowsToWrite[0]?.snapshotDate ?? null,
    lastWrittenDate: rowsToWrite[rowsToWrite.length - 1]?.snapshotDate ?? null,
    priceFloorDate,
    warnings,
  };
}
