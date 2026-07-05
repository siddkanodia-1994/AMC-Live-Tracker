import { backfillDailySnapshots } from "../src/lib/aum/backfill";

async function main() {
  const [fromDate, toDate, reportPeriod] = process.argv.slice(2);
  console.log(`Backfilling daily AUM snapshots${fromDate ? ` from ${fromDate}` : " (auto-detecting range)"}${toDate ? ` to ${toDate}` : ""}${reportPeriod ? ` using report period ${reportPeriod}` : ""}...`);

  const result = await backfillDailySnapshots({ fromDate, toDate, reportPeriod });

  console.log(`\nRange: ${result.fromDate} to ${result.toDate}`);
  console.log(`Trading dates found: ${result.tradingDatesFound}`);
  console.log(`Rows inserted: ${result.rowsInserted}`);
  if (result.warnings.length > 0) {
    console.log(`\nWarnings (${result.warnings.length}):`);
    for (const w of result.warnings) console.log(`  - ${w}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
