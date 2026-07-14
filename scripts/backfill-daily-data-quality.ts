// One-time (rerunnable) backfill: computes and upserts a daily_data_quality
// row for every distinct canonical snapshotDate already in
// live_aum_daily_snapshot. Pure DB reads, no DHAN calls -- safe to run for
// the whole history at once, and safe to rerun after a future data
// correction (like the February live-AUM backfill fix) since
// upsertDailyDataQuality overwrites by snapshotDate.
import { db } from "../src/lib/db/client";
import { liveAumDailySnapshot } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { upsertDailyDataQuality } from "../src/lib/aum/daily-data-quality";

async function main() {
  const dates = await db
    .selectDistinct({ date: liveAumDailySnapshot.snapshotDate })
    .from(liveAumDailySnapshot)
    .where(eq(liveAumDailySnapshot.isCanonical, true))
    .orderBy(sql`${liveAumDailySnapshot.snapshotDate} asc`);

  console.log(`Backfilling daily data quality for ${dates.length} trading days...`);
  let done = 0;
  for (const { date } of dates) {
    const row = await upsertDailyDataQuality(date);
    done++;
    if (row) {
      console.log(
        `  ${date}: total=${row.totalHoldings} debt=${row.debtInstruments} foreign=${row.foreignHoldings} nonIsin=${row.nonIsinBearing} inf=${row.infFundUnits} indianStocks=${row.indianStocks} live=${row.liveConsidered} coverage=${row.coveragePct.toFixed(1)}%`
      );
    } else {
      console.log(`  ${date}: skipped (no canonical rows found)`);
    }
  }
  console.log(`\nDone. ${done}/${dates.length} days processed.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
