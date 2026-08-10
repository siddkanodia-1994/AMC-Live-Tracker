import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, holdings, instrumentMap, isinDailyPrice, isinLastCloseLog, indexDailyLevel, liveAumDailySnapshot } from "../db/schema";
import { fetchHistoricalCloses, fetchHistoricalClosesForMany, type HistoricalClose } from "../dhan/historical-client";
import type { ExchangeSegment } from "../dhan/types";
import { INDEX_KEYS, INDEX_SECURITY_IDS, type IndexKey } from "../dhan/indices";
import { computeAmcLiveAumCrForDate } from "./backfill";
import { invalidateLiveAumCache } from "./cache";
import { upsertDailyDataQuality } from "./daily-data-quality";
import { writeIndexDailyLevelRows } from "./index-level-store";
import { writeIsinDailyPriceRows } from "./isin-price-store";
import { getIstDateString } from "../utils/date";
import type { DhanStatus } from "./types";
import { detectAmcOutageDates, detectIndexGapDates, getOutageLookbackDays, getOutageMaxIsinsPerRun } from "./outage-detection";
import {
  getPendingDates,
  getPendingRows,
  markCorrected,
  markFailed,
  markNoData,
  upsertDetectedAmcOutage,
  upsertDetectedIndexGap,
} from "./outage-reclaim-log";

export interface OutageReclaimSummary {
  amc: { datesProcessed: string[]; isinsCorrected: number };
  index: { datesProcessed: string[]; keysCorrected: number };
}

const ZERO_SUMMARY: OutageReclaimSummary = {
  amc: { datesProcessed: [], isinsCorrected: 0 },
  index: { datesProcessed: [], keysCorrected: 0 },
};

function windowStartFor(lookbackDays: number, beforeDate: string): string {
  const d = new Date(`${beforeDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - lookbackDays);
  return d.toISOString().slice(0, 10);
}

// Refreshes the affected AMCs' canonical liveAumDailySnapshot rows for
// `date`, using whatever isin_daily_price values are CURRENTLY stored for
// that date (a mix of previously-live, already-corrected-this-run, and
// still-pending prices) -- always safe to run, reflects current best
// knowledge, and works identically whether this is the first or Nth
// correction pass over a large outage day.
async function recomputeCanonicalSnapshotsForDate(date: string): Promise<void> {
  const existingCanonicalRows = await db
    .select({ amcId: liveAumDailySnapshot.amcId, reportPeriod: liveAumDailySnapshot.reportPeriod, reportedAumCr: liveAumDailySnapshot.reportedAumCr })
    .from(liveAumDailySnapshot)
    .where(and(eq(liveAumDailySnapshot.snapshotDate, date), eq(liveAumDailySnapshot.isCanonical, true)));
  if (existingCanonicalRows.length === 0) return;

  const distinctPeriods = [...new Set(existingCanonicalRows.map((r) => r.reportPeriod))];
  const holdingRows = await db.select().from(holdings).where(inArray(holdings.reportPeriod, distinctPeriods));
  const holdingsByPeriodAmc = new Map<string, typeof holdingRows>();
  for (const h of holdingRows) {
    const k = `${h.reportPeriod}|${h.amcId}`;
    const list = holdingsByPeriodAmc.get(k) ?? [];
    list.push(h);
    holdingsByPeriodAmc.set(k, list);
  }

  const amcPeriodRows = await db
    .select({ amcId: amcPeriods.amcId, reportPeriod: amcPeriods.reportPeriod, residualPlugCr: amcPeriods.residualPlugCr })
    .from(amcPeriods)
    .where(inArray(amcPeriods.reportPeriod, distinctPeriods));
  const residualByPeriodAmc = new Map(amcPeriodRows.map((r) => [`${r.reportPeriod}|${r.amcId}`, Number(r.residualPlugCr)]));

  const allPriceRowsForDate = await db
    .select({ isin: isinDailyPrice.isin, priceInr: isinDailyPrice.priceInr })
    .from(isinDailyPrice)
    .where(eq(isinDailyPrice.snapshotDate, date));
  const closesByIsinAndDate = new Map<string, Map<string, number>>();
  for (const r of allPriceRowsForDate) closesByIsinAndDate.set(r.isin, new Map([[date, Number(r.priceInr)]]));

  for (const row of existingCanonicalRows) {
    const key = `${row.reportPeriod}|${row.amcId}`;
    const amcHoldings = holdingsByPeriodAmc.get(key) ?? [];
    const residualPlugCr = residualByPeriodAmc.get(key) ?? 0;
    const reportedAumCr = Number(row.reportedAumCr);
    const liveAumCr = computeAmcLiveAumCrForDate(amcHoldings, closesByIsinAndDate, date, residualPlugCr);
    const deltaCr = liveAumCr - reportedAumCr;
    const deltaPct = reportedAumCr !== 0 ? deltaCr / reportedAumCr : 0;
    await db
      .update(liveAumDailySnapshot)
      .set({ liveAumCr: String(liveAumCr), deltaCr: String(deltaCr), deltaPct: String(deltaPct), computedAt: sql`now()` })
      .where(and(eq(liveAumDailySnapshot.amcId, row.amcId), eq(liveAumDailySnapshot.snapshotDate, date), eq(liveAumDailySnapshot.isCanonical, true)));
  }
}

/**
 * Only ever works on the SINGLE oldest pending AMC-outage date per call, and
 * chunks that date's flagged ISINs by getOutageMaxIsinsPerRun() -- a genuine
 * detected outage day, by construction of the 50%+ detection threshold,
 * always involves hundreds+ of ISINs (confirmed against a real production
 * outage day: 1,112 of 1,133), which at DHAN's ~500ms/security historical
 * pacing would take 9+ minutes in a single pass -- comfortably over any
 * reasonable cron time budget. "Still pending" for a given ISIN is derived
 * (no extra per-ISIN table needed) by comparing isin_daily_price.computedAt
 * against this outage's own detectedAt: not yet bumped past detection means
 * not yet corrected by an earlier pass. ISINs DHAN genuinely has no
 * historical data for (delisted, etc.) get their existing stored price
 * re-stamped with a fresh computedAt -- a harmless same-value write -- so
 * they count as "attempted" and don't block the date from ever completing.
 */
async function reclaimAmcOutages(): Promise<{ datesProcessed: string[]; isinsCorrected: number }> {
  const today = getIstDateString();
  const lookbackDays = await getOutageLookbackDays();
  const windowStart = windowStartFor(lookbackDays, today);

  const candidates = await detectAmcOutageDates({ windowStart, beforeDate: today });
  for (const c of candidates) {
    await upsertDetectedAmcOutage(c.snapshotDate, c.lastCloseIsinCount, c.universeIsinCount);
  }

  const pendingRows = await getPendingRows("amc_isin", today);
  if (pendingRows.length === 0) return { datesProcessed: [], isinsCorrected: 0 };

  const { snapshotDate: date, detectedAt } = pendingRows[0];

  try {
    const flaggedRows = await db
      .select({ isin: isinLastCloseLog.isin })
      .from(isinLastCloseLog)
      .where(eq(isinLastCloseLog.snapshotDate, date));
    const flaggedIsins = [...new Set(flaggedRows.map((r) => r.isin))];
    if (flaggedIsins.length === 0) {
      await markNoData("amc_isin", date, "No last-close ISINs logged for this date");
      return { datesProcessed: [], isinsCorrected: 0 };
    }

    const priceRows = await db
      .select({ isin: isinDailyPrice.isin, priceInr: isinDailyPrice.priceInr, computedAt: isinDailyPrice.computedAt })
      .from(isinDailyPrice)
      .where(and(eq(isinDailyPrice.snapshotDate, date), inArray(isinDailyPrice.isin, flaggedIsins)));
    const priceRowByIsin = new Map(priceRows.map((r) => [r.isin, r]));
    const stillPending = flaggedIsins.filter((isin) => {
      const row = priceRowByIsin.get(isin);
      return !row || row.computedAt <= detectedAt;
    });

    let isinsCorrectedThisRun = 0;
    if (stillPending.length > 0) {
      const maxIsinsPerRun = await getOutageMaxIsinsPerRun();
      const chunk = stillPending.slice(0, maxIsinsPerRun);

      const instrumentRows = await db.select().from(instrumentMap).where(inArray(instrumentMap.isin, chunk));
      const instrumentByIsin = new Map(instrumentRows.map((r) => [r.isin, r]));

      const requests: { securityId: string; exchangeSegment: ExchangeSegment }[] = [];
      for (const isin of chunk) {
        const mapping = instrumentByIsin.get(isin);
        if (mapping) requests.push({ securityId: mapping.securityId, exchangeSegment: mapping.exchangeSegment as ExchangeSegment });
      }

      const historicalBySecurityKey: Map<string, HistoricalClose[]> =
        requests.length > 0 ? await fetchHistoricalClosesForMany(requests, date, date) : new Map();

      const isinPriceRows: { isin: string; snapshotDate: string; priceInr: number }[] = [];
      for (const isin of chunk) {
        const mapping = instrumentByIsin.get(isin);
        const closes = mapping ? (historicalBySecurityKey.get(`${mapping.exchangeSegment}:${mapping.securityId}`) ?? []) : [];
        const closeForDate = closes.find((c) => c.date === date);
        if (closeForDate) {
          isinPriceRows.push({ isin, snapshotDate: date, priceInr: closeForDate.close });
        } else {
          // DHAN genuinely has no data for this ISIN on this date (unmapped,
          // delisted, DH-905, ...) -- re-stamp the existing value (or skip if
          // there's truly nothing stored) so it counts as "attempted" and
          // never permanently blocks this date from completing.
          const existing = priceRowByIsin.get(isin);
          if (existing) isinPriceRows.push({ isin, snapshotDate: date, priceInr: Number(existing.priceInr) });
        }
      }

      if (isinPriceRows.length > 0) await writeIsinDailyPriceRows(isinPriceRows);
      isinsCorrectedThisRun = isinPriceRows.length;
    }

    await recomputeCanonicalSnapshotsForDate(date);
    invalidateLiveAumCache();

    // Best-effort: refresh this date's stored Daily Data tab coverage row
    // right after this pass's corrections land, so it keeps climbing on its
    // own as reclaim makes progress across cron runs -- without this, a
    // date's coveragePct would only ever be recomputed for "today" (see the
    // daily cron) and would otherwise sit frozen at whatever it was when
    // this outage was first detected, even after the underlying prices are
    // long since fixed. Pure DB reads, no DHAN calls -- isolated so a
    // failure here can never affect the correction writes that just
    // succeeded above.
    await upsertDailyDataQuality(date).catch((err) => {
      console.error("Failed to refresh daily data quality after outage reclaim:", err);
    });

    const refreshedPriceRows = await db
      .select({ isin: isinDailyPrice.isin, computedAt: isinDailyPrice.computedAt })
      .from(isinDailyPrice)
      .where(and(eq(isinDailyPrice.snapshotDate, date), inArray(isinDailyPrice.isin, flaggedIsins)));
    const refreshedByIsin = new Map(refreshedPriceRows.map((r) => [r.isin, r.computedAt]));
    const stillRemaining = flaggedIsins.filter((isin) => {
      const computedAt = refreshedByIsin.get(isin);
      return !computedAt || computedAt <= detectedAt;
    });

    if (stillRemaining.length === 0) {
      await markCorrected("amc_isin", date, { correctedIsinCount: flaggedIsins.length });
      return { datesProcessed: [date], isinsCorrected: isinsCorrectedThisRun };
    }
    // Partial progress on a large outage day -- left as 'detected' so the
    // next cron run continues with the remaining chunk.
    return { datesProcessed: isinsCorrectedThisRun > 0 ? [date] : [], isinsCorrected: isinsCorrectedThisRun };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown error";
    await markFailed("amc_isin", date, detail).catch(() => {});
    throw err;
  }
}

async function reclaimIndexGaps(): Promise<{ datesProcessed: string[]; keysCorrected: number }> {
  const today = getIstDateString();
  const lookbackDays = await getOutageLookbackDays();
  const windowStart = windowStartFor(lookbackDays, today);

  const candidates = await detectIndexGapDates({ windowStart, beforeDate: today });
  for (const c of candidates) {
    await upsertDetectedIndexGap(c.snapshotDate, c.missingKeys);
  }

  const pending = await getPendingDates("index_level", today);
  if (pending.length === 0) return { datesProcessed: [], keysCorrected: 0 };

  // Re-derive exactly which keys are still missing directly (freshest
  // truth, not whatever was recorded at detection time).
  const existingRows = await db
    .select({ indexKey: indexDailyLevel.indexKey, snapshotDate: indexDailyLevel.snapshotDate })
    .from(indexDailyLevel)
    .where(inArray(indexDailyLevel.snapshotDate, pending));
  const existingByDate = new Map<string, Set<string>>();
  for (const r of existingRows) {
    const set = existingByDate.get(r.snapshotDate) ?? new Set<string>();
    set.add(r.indexKey);
    existingByDate.set(r.snapshotDate, set);
  }
  const missingByDate = new Map<string, IndexKey[]>();
  for (const date of pending) {
    const present = existingByDate.get(date) ?? new Set<string>();
    const missing = INDEX_KEYS.filter((k) => !present.has(k));
    if (missing.length > 0) missingByDate.set(date, missing);
  }

  try {
    const rowsToWrite: { indexKey: IndexKey; snapshotDate: string; levelValue: number }[] = [];
    const correctedByDate = new Map<string, Set<IndexKey>>();

    for (const key of INDEX_KEYS) {
      const datesNeedingThisKey = pending.filter((d) => missingByDate.get(d)?.includes(key));
      if (datesNeedingThisKey.length === 0) continue;
      const closes = await fetchHistoricalCloses(
        INDEX_SECURITY_IDS[key],
        "IDX_I",
        datesNeedingThisKey[0],
        datesNeedingThisKey[datesNeedingThisKey.length - 1],
        "INDEX"
      );
      const closesByDate = new Map(closes.map((c) => [c.date, c.close]));
      for (const date of datesNeedingThisKey) {
        const close = closesByDate.get(date);
        if (close === undefined) continue;
        rowsToWrite.push({ indexKey: key, snapshotDate: date, levelValue: close });
        const set = correctedByDate.get(date) ?? new Set<IndexKey>();
        set.add(key);
        correctedByDate.set(date, set);
      }
    }

    if (rowsToWrite.length > 0) await writeIndexDailyLevelRows(rowsToWrite);

    let keysCorrected = 0;
    for (const date of pending) {
      const corrected = correctedByDate.get(date);
      if (corrected && corrected.size > 0) {
        await markCorrected("index_level", date, { indexKeysCorrected: [...corrected] });
        keysCorrected += corrected.size;
      } else {
        await markNoData("index_level", date, "DHAN historical had no data for the missing index(es) on this date");
      }
    }

    invalidateLiveAumCache();
    return { datesProcessed: pending, keysCorrected };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown error";
    for (const date of pending) {
      await markFailed("index_level", date, detail).catch(() => {});
    }
    throw err;
  }
}

/**
 * Auto-detects and self-corrects past DHAN-outage days for both AMC stock
 * prices and Nifty 50/500 index levels -- called once daily from the
 * cron, after that day's own computeLiveAum has already run. Only
 * proceeds when TODAY's own DHAN fetch just succeeded (todayDhanStatus !==
 * "unavailable"), so it never wastes a historical-endpoint retry while
 * still broken.
 */
export async function reclaimDhanOutages(options: { todayDhanStatus: DhanStatus }): Promise<OutageReclaimSummary> {
  if (options.todayDhanStatus === "unavailable") return ZERO_SUMMARY;

  const amc = await reclaimAmcOutages().catch((err) => {
    console.error("Failed to reclaim AMC-side DHAN outages:", err);
    return { datesProcessed: [], isinsCorrected: 0 };
  });
  const index = await reclaimIndexGaps().catch((err) => {
    console.error("Failed to reclaim index-level DHAN gaps:", err);
    return { datesProcessed: [], keysCorrected: 0 };
  });
  return { amc, index };
}
