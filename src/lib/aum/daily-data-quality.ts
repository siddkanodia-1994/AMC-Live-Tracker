import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { dailyDataQuality, holdings, isinDailyPrice, liveAumDailySnapshot } from "../db/schema";
import { isBankDebtOrRepo, isForeignIsin } from "../excel/instrument-classification";

export interface DailyDataQualityRow {
  snapshotDate: string;
  totalHoldings: number;
  debtInstruments: number;
  foreignHoldings: number;
  nonIsinBearing: number;
  infFundUnits: number;
  indianStocks: number;
  liveConsidered: number;
  coveragePct: number;
}

/**
 * Computes one trading day's industry-wide DHAN price-coverage stats: how
 * much of that day's holding universe (across every AMC, using whichever
 * reportPeriod each AMC's liveAumDailySnapshot canonically used that day)
 * actually got a live close, versus debt/foreign/non-ISIN/fund-unit lines
 * that never could. Every category below is mutually exclusive and their
 * sum exactly equals totalHoldings -- verified against real data before
 * this was built (audited 2026-07-14: zero overlaps, zero leftovers).
 * Pure DB reads -- no DHAN calls -- so this is cheap and safe to run for
 * an entire history in one script (see backfill-daily-data-quality.ts).
 */
export async function computeDailyDataQualityForDate(date: string): Promise<DailyDataQualityRow | null> {
  const canonicalRows = await db
    .select({ amcId: liveAumDailySnapshot.amcId, reportPeriod: liveAumDailySnapshot.reportPeriod })
    .from(liveAumDailySnapshot)
    .where(and(eq(liveAumDailySnapshot.snapshotDate, date), eq(liveAumDailySnapshot.isCanonical, true)));

  if (canonicalRows.length === 0) return null;

  const amcIdsByPeriod = new Map<string, number[]>();
  for (const r of canonicalRows) {
    const list = amcIdsByPeriod.get(r.reportPeriod) ?? [];
    list.push(r.amcId);
    amcIdsByPeriod.set(r.reportPeriod, list);
  }

  const totalKeys = new Set<string>();
  const debtKeys = new Set<string>();
  const foreignIsins = new Set<string>();
  // No ISIN and not debt/repo -- cash-equivalent lines, no-ISIN
  // derivative/option positions, defunct/delisted listings. Deliberately
  // excludes no-ISIN debt/repo lines (TREPS, Call Money, CBLO), which are
  // already inside debtKeys -- keeps this and debtInstruments from ever
  // double-counting the same line item.
  const nonIsinBearingKeys = new Set<string>();
  // ISIN present but "INF"-prefixed -- one AMC holding another mutual
  // fund/ETF's units, not an individual stock. Always isPriceable=false
  // (see parse-amc-sheet.ts), so never overlaps eligibleEquityIsins below.
  const infFundUnitIsins = new Set<string>();
  const eligibleEquityIsins = new Set<string>();

  for (const [reportPeriod, amcIds] of amcIdsByPeriod) {
    const holdingRows = await db
      .select({
        amcId: holdings.amcId,
        companyName: holdings.companyName,
        sector: holdings.sector,
        isin: holdings.isin,
        isPriceable: holdings.isPriceable,
      })
      .from(holdings)
      .where(and(eq(holdings.reportPeriod, reportPeriod), inArray(holdings.amcId, amcIds)));

    for (const h of holdingRows) {
      const key = h.isin ?? h.companyName.trim().toLowerCase();
      totalKeys.add(key);

      const isDebt = isBankDebtOrRepo(h.sector, h.companyName);
      if (isDebt) {
        debtKeys.add(key);
      } else if (h.isin && isForeignIsin(h.isin)) {
        foreignIsins.add(h.isin);
      } else if (h.isin && h.isin.startsWith("INF")) {
        infFundUnitIsins.add(h.isin);
      } else if (!h.isin) {
        nonIsinBearingKeys.add(key);
      }

      if (h.isPriceable && h.isin) eligibleEquityIsins.add(h.isin);
    }
  }

  const totalHoldings = totalKeys.size;
  const debtInstruments = debtKeys.size;
  const foreignHoldings = foreignIsins.size;
  const nonIsinBearing = nonIsinBearingKeys.size;
  const infFundUnits = infFundUnitIsins.size;
  const indianStocks = totalHoldings - debtInstruments - foreignHoldings - nonIsinBearing - infFundUnits;

  let liveConsidered = 0;
  if (eligibleEquityIsins.size > 0) {
    const priced = await db
      .select({ isin: isinDailyPrice.isin })
      .from(isinDailyPrice)
      .where(and(eq(isinDailyPrice.snapshotDate, date), inArray(isinDailyPrice.isin, [...eligibleEquityIsins])));
    liveConsidered = priced.length;
  }

  const coveragePct = indianStocks !== 0 ? (liveConsidered / indianStocks) * 100 : 0;

  return {
    snapshotDate: date,
    totalHoldings,
    debtInstruments,
    foreignHoldings,
    nonIsinBearing,
    infFundUnits,
    indianStocks,
    liveConsidered,
    coveragePct,
  };
}

export async function upsertDailyDataQuality(date: string): Promise<DailyDataQualityRow | null> {
  const row = await computeDailyDataQualityForDate(date);
  if (!row) return null;

  await db
    .insert(dailyDataQuality)
    .values({
      snapshotDate: row.snapshotDate,
      totalHoldings: row.totalHoldings,
      debtInstruments: row.debtInstruments,
      foreignHoldings: row.foreignHoldings,
      nonIsinBearing: row.nonIsinBearing,
      infFundUnits: row.infFundUnits,
      indianStocks: row.indianStocks,
      liveConsidered: row.liveConsidered,
      coveragePct: String(row.coveragePct),
    })
    .onConflictDoUpdate({
      target: dailyDataQuality.snapshotDate,
      set: {
        totalHoldings: row.totalHoldings,
        debtInstruments: row.debtInstruments,
        foreignHoldings: row.foreignHoldings,
        nonIsinBearing: row.nonIsinBearing,
        infFundUnits: row.infFundUnits,
        indianStocks: row.indianStocks,
        liveConsidered: row.liveConsidered,
        coveragePct: String(row.coveragePct),
        computedAt: sql`now()`,
      },
    });

  return row;
}

export async function getDailyDataQualityHistory(): Promise<DailyDataQualityRow[]> {
  const rows = await db.select().from(dailyDataQuality).orderBy(asc(dailyDataQuality.snapshotDate));
  return rows.map((r) => ({
    snapshotDate: r.snapshotDate,
    totalHoldings: r.totalHoldings,
    debtInstruments: r.debtInstruments,
    foreignHoldings: r.foreignHoldings,
    nonIsinBearing: r.nonIsinBearing,
    infFundUnits: r.infFundUnits,
    indianStocks: r.indianStocks,
    liveConsidered: r.liveConsidered,
    coveragePct: Number(r.coveragePct),
  }));
}

export interface DailyDataQualityAlert {
  count: number;
  worstDate: string;
  worstPct: number;
}

/**
 * Cheap standing regression-guard check for the Overview banner: how many
 * stored days currently sit below the 80% floor, and the single worst one
 * -- across the WHOLE history, not just today, so a past gap (like the
 * February incident) keeps surfacing until it's actually fixed.
 */
export async function getDailyDataQualityAlerts(thresholdPct = 80): Promise<DailyDataQualityAlert | null> {
  const rows = await db
    .select({ snapshotDate: dailyDataQuality.snapshotDate, coveragePct: dailyDataQuality.coveragePct })
    .from(dailyDataQuality)
    .where(lte(dailyDataQuality.coveragePct, String(thresholdPct)))
    .orderBy(asc(dailyDataQuality.coveragePct));

  if (rows.length === 0) return null;
  return { count: rows.length, worstDate: rows[0].snapshotDate, worstPct: Number(rows[0].coveragePct) };
}
