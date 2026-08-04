import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { dailyDataQuality, holdings, isinDailyPrice, isinLastCloseLog, liveAumDailySnapshot, outageReclaimLog } from "../db/schema";
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
 *
 * liveConsidered/coveragePct start from isinLastCloseLog (which ISINs were
 * classified priceSource==="last_close" that specific day), NOT "does an
 * isin_daily_price row exist" -- the outage-day last_close fallback
 * (compute-live-aum.ts) still writes a row for today's date even on a
 * total DHAN outage, so a row-exists check can't distinguish a genuinely
 * healthy day from a fully-stale one (audited 2026-08-03: a real outage on
 * 2026-07-29 left this metric completely flat for 23 straight trading
 * days). isinLastCloseLog is the same per-day signal outage-detection.ts's
 * detectAmcOutageDates already relies on for exactly this reason.
 *
 * A last-close-flagged ISIN counts as covered again once outage-reclaim.ts
 * has genuinely corrected it (a real DHAN historical close fetched after
 * detection, not just the original stale carry-forward) -- this tab
 * reflects CURRENT data quality, not a permanent "an outage once happened
 * here" audit log (confirmed with the user: once fixed, show the
 * rectified %). An ISIN DHAN never had data for even after reclaim (e.g.
 * delisted) stays counted as missing -- a real, permanent, honestly-shown
 * gap, not silently excluded.
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

  let liveConsidered = eligibleEquityIsins.size;
  if (eligibleEquityIsins.size > 0) {
    const isinList = [...eligibleEquityIsins];
    // Neon's HTTP driver chokes on a single query with 1000+ bind params
    // (confirmed 2026-08-04: a 1127-param IN-clause timed out entirely) --
    // chunk both ISIN-list lookups below, same BATCH_SIZE convention
    // already used for bulk writes (isin-price-store.ts).
    const BATCH_SIZE = 500;

    // Does ANY isin_daily_price row exist at all for this date? Absence
    // here means priceSource==="stale_fallback" that day (DHAN had no live
    // price AND no prior price to carry forward at all) -- a strictly
    // worse, permanently-blind category that never appears in
    // isinLastCloseLog (that log only covers last_close, which requires a
    // prior price to exist). Confirmed via direct audit (2026-08-03): 21 of
    // 1133 eligible ISINs have literally no price row on an ordinary
    // healthy day -- these must still count as missing, or coverage
    // silently looks better than reality.
    const pricedByIsin = new Map<string, Date>();
    for (let i = 0; i < isinList.length; i += BATCH_SIZE) {
      const batch = isinList.slice(i, i + BATCH_SIZE);
      const rows = await db
        .select({ isin: isinDailyPrice.isin, computedAt: isinDailyPrice.computedAt })
        .from(isinDailyPrice)
        .where(and(eq(isinDailyPrice.snapshotDate, date), inArray(isinDailyPrice.isin, batch)));
      for (const r of rows) pricedByIsin.set(r.isin, r.computedAt);
    }
    const neverPricedCount = isinList.length - pricedByIsin.size;

    const lastCloseIsins = new Set<string>();
    for (let i = 0; i < isinList.length; i += BATCH_SIZE) {
      const batch = isinList.slice(i, i + BATCH_SIZE);
      const rows = await db
        .select({ isin: isinLastCloseLog.isin })
        .from(isinLastCloseLog)
        .where(and(eq(isinLastCloseLog.snapshotDate, date), inArray(isinLastCloseLog.isin, batch)));
      for (const r of rows) lastCloseIsins.add(r.isin);
    }

    let stillStaleCount = lastCloseIsins.size;
    if (lastCloseIsins.size > 0) {
      // If this date has since been reclaimed, some (or all) of these
      // last-close ISINs may have a genuine DHAN historical close written
      // AFTER the outage was detected -- those count as covered again.
      // Ones DHAN still had nothing for stay counted as missing.
      const [correctedOutage] = await db
        .select({ detectedAt: outageReclaimLog.detectedAt })
        .from(outageReclaimLog)
        .where(
          and(
            eq(outageReclaimLog.kind, "amc_isin"),
            eq(outageReclaimLog.snapshotDate, date),
            eq(outageReclaimLog.status, "corrected")
          )
        );
      if (correctedOutage) {
        const rectifiedCount = [...lastCloseIsins].filter((isin) => {
          const computedAt = pricedByIsin.get(isin);
          return computedAt !== undefined && computedAt > correctedOutage.detectedAt;
        }).length;
        stillStaleCount = lastCloseIsins.size - rectifiedCount;
      }
    }
    liveConsidered = eligibleEquityIsins.size - neverPricedCount - stillStaleCount;
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
  // Newest first -- each new trading day the cron adds automatically sorts
  // to the top, since its date string is lexicographically greater than
  // every prior one. Table display and Excel export both read this same
  // array, so both follow this order.
  const rows = await db.select().from(dailyDataQuality).orderBy(desc(dailyDataQuality.snapshotDate));
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
