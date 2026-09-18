import { desc, gte, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { instrumentMap, staleMappingCorrectionLog, staleMappingUnresolvedLog } from "../db/schema";
import { downloadInstrumentMaster, pickPreferredInstrumentRow } from "../dhan/instrument-master";
import type { ExchangeSegment } from "../dhan/types";
import { backfillIsinPriceHistory, STALE_MAPPING_BACKFILL_LOOKBACK_DAYS } from "./isin-price-backfill";

export interface StaleMappingCandidate {
  isin: string;
  companyName: string;
}

export interface StaleMappingCorrection {
  isin: string;
  companyName: string;
  oldSecurityId: string | null;
  oldExchangeSegment: string | null;
  newSecurityId: string;
  newExchangeSegment: string;
  // Trading days backfillIsinPriceHistory actually found/wrote for the new
  // ID -- 0 means the mapping fix succeeded but DHAN had no historical
  // data to backfill, which the UI surfaces distinctly (see corrections-log.tsx).
  backfillDatesCount: number;
}

/**
 * Self-heals ISINs that have been stuck on last_close for the auto-mute
 * threshold's worth of trading days (see the daily-snapshot cron) by
 * re-checking each one's mapping against DHAN's current instrument
 * master. A stuck streak that long, for just one or a handful of ISINs
 * -- never enough to trip outage-reclaim.ts's whole-day, whole-universe
 * 50% threshold -- is exactly the signature of a stale security ID: DHAN
 * reissued it and instrument_map was never re-synced (confirmed real
 * incident, 2026-08-10: 6 ISINs, some stuck 6-8 trading days, invisible
 * to every other monitoring layer until manually audited). Only acts
 * when the stored mapping genuinely differs from DHAN's current master
 * -- a candidate whose mapping is still correct (genuine illiquidity or
 * a real trading suspension, not a stale ID) is left untouched.
 */
export async function reclaimStaleInstrumentMappings(candidates: StaleMappingCandidate[]): Promise<StaleMappingCorrection[]> {
  if (candidates.length === 0) return [];

  const isins = candidates.map((c) => c.isin);
  const storedRows = await db.select().from(instrumentMap).where(inArray(instrumentMap.isin, isins));
  const storedByIsin = new Map(storedRows.map((r) => [r.isin, r]));

  const master = await downloadInstrumentMaster();
  const masterByIsin = new Map<string, typeof master>();
  for (const row of master) {
    const list = masterByIsin.get(row.isin) ?? [];
    list.push(row);
    masterByIsin.set(row.isin, list);
  }

  const corrections: StaleMappingCorrection[] = [];

  for (const { isin, companyName } of candidates) {
    const masterRows = masterByIsin.get(isin);
    if (!masterRows || masterRows.length === 0) {
      // DHAN genuinely has nothing for this ISIN -- not a mapping bug we
      // can self-heal (e.g. delisted, or the ISIN itself changed, which
      // would show up here as "no entry" since master is keyed by ISIN).
      // Recorded so it doesn't stay invisible indefinitely -- upserted on
      // isin so a candidate stuck for many days doesn't flood the log
      // with one row per day.
      const stored = storedByIsin.get(isin);
      await db
        .insert(staleMappingUnresolvedLog)
        .values({
          isin,
          companyName,
          oldSecurityId: stored?.securityId ?? null,
          oldExchangeSegment: stored?.exchangeSegment ?? null,
        })
        .onConflictDoUpdate({
          target: staleMappingUnresolvedLog.isin,
          set: {
            companyName,
            oldSecurityId: stored?.securityId ?? null,
            oldExchangeSegment: stored?.exchangeSegment ?? null,
            lastCheckedAt: new Date(),
          },
        });
      continue;
    }

    const preferred = pickPreferredInstrumentRow(masterRows);
    if (!preferred) continue;

    const stored = storedByIsin.get(isin);
    if (stored && stored.securityId === preferred.securityId && stored.exchangeSegment === preferred.exchangeSegment) {
      continue; // mapping is already correct -- not a stale-ID problem
    }

    await db
      .insert(instrumentMap)
      .values({
        isin,
        securityId: preferred.securityId,
        exchangeSegment: preferred.exchangeSegment,
        tradingSymbol: preferred.tradingSymbol,
      })
      .onConflictDoUpdate({
        target: instrumentMap.isin,
        set: {
          securityId: preferred.securityId,
          exchangeSegment: preferred.exchangeSegment,
          tradingSymbol: preferred.tradingSymbol,
          updatedAt: new Date(),
        },
      });

    // Runs BEFORE the correction is logged (not after) so the log row can
    // record the backfill's real outcome instead of just assuming success
    // -- also corrects however much of this ISIN's recent price history
    // was silently wrong while the mapping was broken, see
    // isin-price-backfill.ts. Runs regardless of how long it's been
    // wrong; over-fetching an already-correct day is harmless.
    const { datesUpdated } = await backfillIsinPriceHistory(
      isin,
      preferred.securityId,
      preferred.exchangeSegment as ExchangeSegment,
      STALE_MAPPING_BACKFILL_LOOKBACK_DAYS
    );

    const correction: StaleMappingCorrection = {
      isin,
      companyName,
      oldSecurityId: stored?.securityId ?? null,
      oldExchangeSegment: stored?.exchangeSegment ?? null,
      newSecurityId: preferred.securityId,
      newExchangeSegment: preferred.exchangeSegment,
      backfillDatesCount: datesUpdated.length,
    };

    await db.insert(staleMappingCorrectionLog).values(correction);

    corrections.push(correction);
  }

  return corrections;
}

export interface StaleMappingCorrectionRow extends Omit<StaleMappingCorrection, "backfillDatesCount"> {
  correctedAt: string;
  // number | null (not just number, unlike a freshly-written correction)
  // since rows predating this column genuinely have no recorded count.
  backfillDatesCount: number | null;
}

/** Feeds the Overview page's "N stock DHAN mapping(s) auto-corrected" disclosure -- most recent first. */
export async function getRecentStaleMappingCorrections(sinceDaysAgo = 30): Promise<StaleMappingCorrectionRow[]> {
  const cutoff = new Date(Date.now() - sinceDaysAgo * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(staleMappingCorrectionLog)
    .where(gte(staleMappingCorrectionLog.correctedAt, cutoff))
    .orderBy(desc(staleMappingCorrectionLog.correctedAt));

  return rows.map((r) => ({
    isin: r.isin,
    companyName: r.companyName,
    oldSecurityId: r.oldSecurityId,
    oldExchangeSegment: r.oldExchangeSegment,
    newSecurityId: r.newSecurityId,
    newExchangeSegment: r.newExchangeSegment,
    // null for rows predating this column (genuinely unrecorded, not
    // zero) -- see the schema comment on staleMappingCorrectionLog.
    backfillDatesCount: r.backfillDatesCount,
    correctedAt: r.correctedAt.toISOString(),
  }));
}

export interface UnresolvedStaleMapping {
  isin: string;
  companyName: string;
  oldSecurityId: string | null;
  oldExchangeSegment: string | null;
  firstCheckedAt: string;
  lastCheckedAt: string;
}

/**
 * ISINs that have been stale-mapping candidates but DHAN's own
 * instrument master has no entry at all for them, so
 * reclaimStaleInstrumentMappings can't self-heal them -- these need a
 * human look (delisted? merged? the ISIN itself changed?). Most
 * recently re-checked first; an ISIN that stops being a candidate (fixed
 * some other way) naturally ages out of this "recent" window on its own.
 */
export async function getUnresolvedStaleMappings(sinceDaysAgo = 30): Promise<UnresolvedStaleMapping[]> {
  const cutoff = new Date(Date.now() - sinceDaysAgo * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(staleMappingUnresolvedLog)
    .where(gte(staleMappingUnresolvedLog.lastCheckedAt, cutoff))
    .orderBy(desc(staleMappingUnresolvedLog.lastCheckedAt));

  return rows.map((r) => ({
    isin: r.isin,
    companyName: r.companyName,
    oldSecurityId: r.oldSecurityId,
    oldExchangeSegment: r.oldExchangeSegment,
    firstCheckedAt: r.firstCheckedAt.toISOString(),
    lastCheckedAt: r.lastCheckedAt.toISOString(),
  }));
}
