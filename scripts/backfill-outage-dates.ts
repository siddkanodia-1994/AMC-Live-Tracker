// One-off backfill for whole-day DHAN outages that need correcting NOW
// rather than waiting on the normal oldest-first, 150-ISIN/day queue in
// outage-reclaim.ts. Reuses the exact same safe primitives (paced
// historical fetch, DH-905 handling, canonical snapshot recompute) --
// just drives them directly per date, with no per-run ISIN cap, since
// this only ever runs locally, never inside a time-boxed Vercel function.
//
// Context (2026-08-18): the DHAN token lapsed on 14 Aug and 17 Aug, so
// both days' entire snapshot fell back to last-close for ~1,112 of 1,133
// ISINs. 6 Aug's original outage (already mid-flight via the normal
// queue, 909/1112 done) also stalled on those same two days. This script
// finishes 6 Aug and force-corrects 14 Aug and 17 Aug immediately.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { isinLastCloseLog, isinDailyPrice, instrumentMap, outageReclaimLog } from "../src/lib/db/schema";
import { fetchHistoricalClosesForMany, type HistoricalClose } from "../src/lib/dhan/historical-client";
import type { ExchangeSegment } from "../src/lib/dhan/types";
import { writeIsinDailyPriceRows } from "../src/lib/aum/isin-price-store";
import { recomputeCanonicalSnapshotsForDate } from "../src/lib/aum/outage-reclaim";
import { invalidateLiveAumCache } from "../src/lib/aum/cache";
import { upsertDetectedAmcOutage, markCorrected } from "../src/lib/aum/outage-reclaim-log";
import { computeDailyDataQualityForDate, upsertDailyDataQuality } from "../src/lib/aum/daily-data-quality";

const DATES_TO_CORRECT = ["2026-08-06", "2026-08-14", "2026-08-17"];

async function correctDate(date: string): Promise<void> {
  console.log(`\n=== ${date} ===`);

  const flaggedRows = await db.select({ isin: isinLastCloseLog.isin }).from(isinLastCloseLog).where(eq(isinLastCloseLog.snapshotDate, date));
  const flaggedIsins = [...new Set(flaggedRows.map((r) => r.isin))];
  console.log(`  ${flaggedIsins.length} ISINs flagged last-close`);
  if (flaggedIsins.length === 0) {
    console.log("  Nothing to do.");
    return;
  }

  const [existing] = await db.select().from(outageReclaimLog).where(and(eq(outageReclaimLog.kind, "amc_isin"), eq(outageReclaimLog.snapshotDate, date)));

  let detectedAt: Date;
  if (existing) {
    detectedAt = existing.detectedAt;
    console.log(`  Existing outage_reclaim_log row found (status=${existing.status}, detectedAt=${detectedAt.toISOString()})`);
  } else {
    const quality = await computeDailyDataQualityForDate(date);
    const universeIsinCount = quality?.indianStocks ?? 0;
    await upsertDetectedAmcOutage(date, flaggedIsins.length, universeIsinCount);
    const [row] = await db.select().from(outageReclaimLog).where(and(eq(outageReclaimLog.kind, "amc_isin"), eq(outageReclaimLog.snapshotDate, date)));
    detectedAt = row!.detectedAt;
    console.log(`  Registered new outage (universe=${universeIsinCount}), detectedAt=${detectedAt.toISOString()}`);
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
  console.log(`  ${stillPending.length} ISINs still genuinely stale (need correction)`);

  if (stillPending.length > 0) {
    const instrumentRows = await db.select().from(instrumentMap).where(inArray(instrumentMap.isin, stillPending));
    const instrumentByIsin = new Map(instrumentRows.map((r) => [r.isin, r]));

    const requests: { securityId: string; exchangeSegment: ExchangeSegment }[] = [];
    for (const isin of stillPending) {
      const mapping = instrumentByIsin.get(isin);
      if (mapping) requests.push({ securityId: mapping.securityId, exchangeSegment: mapping.exchangeSegment as ExchangeSegment });
    }

    console.log(`  Fetching ${requests.length} real historical closes from DHAN (paced ~500ms each, this will take a while)...`);
    const historicalBySecurityKey: Map<string, HistoricalClose[]> = requests.length > 0 ? await fetchHistoricalClosesForMany(requests, date, date, (done, total) => {
      if (done % 100 === 0 || done === total) console.log(`    ...${done}/${total}`);
    }) : new Map();

    const isinPriceRows: { isin: string; snapshotDate: string; priceInr: number }[] = [];
    for (const isin of stillPending) {
      const mapping = instrumentByIsin.get(isin);
      const closes = mapping ? (historicalBySecurityKey.get(`${mapping.exchangeSegment}:${mapping.securityId}`) ?? []) : [];
      const closeForDate = closes.find((c) => c.date === date);
      if (closeForDate) {
        isinPriceRows.push({ isin, snapshotDate: date, priceInr: closeForDate.close });
      } else {
        const existingPrice = priceRowByIsin.get(isin);
        if (existingPrice) isinPriceRows.push({ isin, snapshotDate: date, priceInr: Number(existingPrice.priceInr) });
      }
    }

    if (isinPriceRows.length > 0) await writeIsinDailyPriceRows(isinPriceRows);
    console.log(`  Wrote ${isinPriceRows.length} price rows`);
  }

  await recomputeCanonicalSnapshotsForDate(date);
  invalidateLiveAumCache();
  await upsertDailyDataQuality(date);
  console.log(`  Recomputed canonical snapshots + daily data quality for ${date}`);

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
    console.log(`  ${date} fully corrected (${flaggedIsins.length}/${flaggedIsins.length}).`);
  } else {
    console.log(`  ${date} still has ${stillRemaining.length} unresolved (DHAN had no data for these -- left as 'detected').`);
  }
}

async function main() {
  for (const date of DATES_TO_CORRECT) {
    await correctDate(date);
  }
  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
