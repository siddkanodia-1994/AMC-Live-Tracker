import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, amcs, appSettings, holdings, instrumentMap, liveAumDailySnapshot } from "../db/schema";
import { fetchHistoricalClosesForMany } from "../dhan/historical-client";
import type { ExchangeSegment } from "../dhan/types";
import { CRORE } from "../utils/constants";
import { firstDayOfNextMonth } from "./report-period";

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function yesterdayIst(): string {
  const now = new Date(Date.now() + IST_OFFSET_MS);
  now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().slice(0, 10);
}

export interface BackfillResult {
  fromDate: string;
  toDate: string;
  tradingDatesFound: number;
  rowsInserted: number;
  warnings: string[];
}

/**
 * Backfills live_aum_daily_snapshot for the gap between "start of the month
 * after the current report period" and whatever's already been captured live
 * (auto-detected as the earliest existing snapshot date, or yesterday if none
 * exist yet). Uses DHAN's historical EOD closes and CURRENT holdings/shares
 * (we have no historical holdings snapshots — AMCs don't publish daily
 * holdings — so share counts are assumed constant back to the report date,
 * same assumption the live compute already makes for "right now").
 */
export async function backfillDailySnapshots(options?: {
  reportPeriod?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<BackfillResult> {
  const warnings: string[] = [];

  let reportPeriod = options?.reportPeriod;
  if (!reportPeriod) {
    const [periodRow] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, CURRENT_REPORT_PERIOD_KEY));
    if (!periodRow) throw new Error("No report period configured — import a workbook first.");
    reportPeriod = periodRow.value;
  }

  const fromDate = options?.fromDate ?? firstDayOfNextMonth(reportPeriod);

  let toDate = options?.toDate;
  if (!toDate) {
    const [{ minDate }] = await db
      .select({ minDate: sql<string | null>`min(${liveAumDailySnapshot.snapshotDate})` })
      .from(liveAumDailySnapshot);
    toDate = minDate ? dayBefore(minDate) : yesterdayIst();
  }

  if (fromDate > toDate) {
    return { fromDate, toDate, tradingDatesFound: 0, rowsInserted: 0, warnings: ["Nothing to backfill — from-date is after to-date (gap already covered)."] };
  }

  const periodRows = await db
    .select({
      amcId: amcPeriods.amcId,
      reportedAumCr: amcPeriods.reportedAumCr,
      residualPlugCr: amcPeriods.residualPlugCr,
    })
    .from(amcPeriods)
    .innerJoin(amcs, eq(amcPeriods.amcId, amcs.id))
    .where(eq(amcPeriods.reportPeriod, reportPeriod));

  const holdingRows = await db.select().from(holdings).where(eq(holdings.reportPeriod, reportPeriod));
  const instrumentRows = await db.select().from(instrumentMap);
  const instrumentByIsin = new Map(instrumentRows.map((r) => [r.isin, r]));

  const priceableIsins = new Set<string>();
  for (const h of holdingRows) {
    if (h.isPriceable && h.isin) priceableIsins.add(h.isin);
  }

  const isinToSegmentKey = new Map<string, string>();
  const requests: { securityId: string; exchangeSegment: ExchangeSegment }[] = [];
  for (const isin of priceableIsins) {
    const mapping = instrumentByIsin.get(isin);
    if (!mapping) continue;
    const key = `${mapping.exchangeSegment}:${mapping.securityId}`;
    isinToSegmentKey.set(isin, key);
    requests.push({ securityId: mapping.securityId, exchangeSegment: mapping.exchangeSegment as ExchangeSegment });
  }

  if (requests.length === 0) {
    warnings.push("No mapped priceable ISINs found — run the instrument sync first.");
    return { fromDate, toDate, tradingDatesFound: 0, rowsInserted: 0, warnings };
  }

  const historicalBySecurityKey = await fetchHistoricalClosesForMany(requests, fromDate, toDate, (done, total) => {
    if (done % 100 === 0 || done === total) {
      console.log(`  historical fetch progress: ${done}/${total}`);
    }
  });

  // isin -> date -> close
  const closesByIsinAndDate = new Map<string, Map<string, number>>();
  const allTradingDates = new Set<string>();
  let unmatchedIsinCount = 0;
  for (const isin of priceableIsins) {
    const key = isinToSegmentKey.get(isin);
    if (!key) continue;
    const closes = historicalBySecurityKey.get(key) ?? [];
    if (closes.length === 0) {
      unmatchedIsinCount++;
      continue;
    }
    const byDate = new Map(closes.map((c) => [c.date, c.close]));
    closesByIsinAndDate.set(isin, byDate);
    for (const date of byDate.keys()) allTradingDates.add(date);
  }

  if (unmatchedIsinCount > 0) {
    warnings.push(`${unmatchedIsinCount} priceable ISINs had no historical data in range — those holdings fall back to reported value for backfilled dates.`);
  }

  const sortedDates = [...allTradingDates].sort();
  if (sortedDates.length === 0) {
    warnings.push("No trading dates found in the historical data returned — nothing to backfill.");
    return { fromDate, toDate, tradingDatesFound: 0, rowsInserted: 0, warnings };
  }

  const holdingsByAmcId = new Map<number, typeof holdingRows>();
  for (const h of holdingRows) {
    const list = holdingsByAmcId.get(h.amcId) ?? [];
    list.push(h);
    holdingsByAmcId.set(h.amcId, list);
  }

  const rowsToInsert: (typeof liveAumDailySnapshot.$inferInsert)[] = [];

  for (const date of sortedDates) {
    for (const period of periodRows) {
      const amcHoldings = holdingsByAmcId.get(period.amcId) ?? [];
      let liveSumCr = 0;

      for (const h of amcHoldings) {
        const reportedMarketValueCr = Number(h.marketValueCr);
        if (!h.isPriceable || !h.isin) {
          liveSumCr += reportedMarketValueCr;
          continue;
        }
        const close = closesByIsinAndDate.get(h.isin)?.get(date);
        if (close !== undefined) {
          liveSumCr += (close * Number(h.shares)) / CRORE;
        } else {
          liveSumCr += reportedMarketValueCr;
        }
      }

      const residualPlugCr = Number(period.residualPlugCr);
      const reportedAumCr = Number(period.reportedAumCr);
      const liveAumCr = liveSumCr + residualPlugCr;
      const deltaCr = liveAumCr - reportedAumCr;
      const deltaPct = reportedAumCr !== 0 ? deltaCr / reportedAumCr : 0;

      rowsToInsert.push({
        amcId: period.amcId,
        snapshotDate: date,
        reportPeriod,
        liveAumCr: String(liveAumCr),
        reportedAumCr: String(reportedAumCr),
        deltaCr: String(deltaCr),
        deltaPct: String(deltaPct),
      });
    }
  }

  let rowsInserted = 0;
  const BATCH_SIZE = 500;
  for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
    const batch = rowsToInsert.slice(i, i + BATCH_SIZE);
    const result = await db
      .insert(liveAumDailySnapshot)
      .values(batch)
      .onConflictDoNothing({ target: [liveAumDailySnapshot.amcId, liveAumDailySnapshot.snapshotDate] })
      .returning({ id: liveAumDailySnapshot.id });
    rowsInserted += result.length;
  }

  return { fromDate, toDate, tradingDatesFound: sortedDates.length, rowsInserted, warnings };
}
