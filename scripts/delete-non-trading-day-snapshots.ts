// One-time cleanup: deletes live_aum_daily_snapshot and isin_daily_price
// rows dated on a non-trading day (weekend or NSE holiday). These were
// written by two now-fixed bugs -- the cron fired every day of the week
// regardless, and force-dynamic page visits independently re-triggered a
// write on any 45s cache miss -- before isTradingDay() was wired into
// compute-live-aum.ts's write path. Scans full history rather than assuming
// specific dates; safe to re-run (reports nothing to delete once clean).
import { inArray } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { isinDailyPrice, liveAumDailySnapshot } from "../src/lib/db/schema";
import { isTradingDay } from "../src/lib/utils/market-hours";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const snapshotDates = await db.selectDistinct({ snapshotDate: liveAumDailySnapshot.snapshotDate }).from(liveAumDailySnapshot);
  const isinPriceDates = await db.selectDistinct({ snapshotDate: isinDailyPrice.snapshotDate }).from(isinDailyPrice);

  const badSnapshotDates = snapshotDates.map((r) => r.snapshotDate).filter((d) => !isTradingDay(new Date(`${d}T00:00:00Z`)));
  const badIsinPriceDates = isinPriceDates.map((r) => r.snapshotDate).filter((d) => !isTradingDay(new Date(`${d}T00:00:00Z`)));

  console.log(`live_aum_daily_snapshot: ${badSnapshotDates.length} non-trading-day date(s) found: ${badSnapshotDates.join(", ") || "(none)"}`);
  console.log(`isin_daily_price: ${badIsinPriceDates.length} non-trading-day date(s) found: ${badIsinPriceDates.join(", ") || "(none)"}`);

  if (dryRun) {
    console.log("\n--dry-run: not deleting anything.");
    process.exit(0);
  }

  if (badSnapshotDates.length > 0) {
    const result = await db
      .delete(liveAumDailySnapshot)
      .where(inArray(liveAumDailySnapshot.snapshotDate, badSnapshotDates))
      .returning({ id: liveAumDailySnapshot.id });
    console.log(`Deleted ${result.length} row(s) from live_aum_daily_snapshot.`);
  }

  if (badIsinPriceDates.length > 0) {
    const result = await db
      .delete(isinDailyPrice)
      .where(inArray(isinDailyPrice.snapshotDate, badIsinPriceDates))
      .returning({ id: isinDailyPrice.id });
    console.log(`Deleted ${result.length} row(s) from isin_daily_price.`);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
