import { syncForeignInstrumentMap } from "../src/lib/aum/foreign-pricing";

async function main() {
  const result = await syncForeignInstrumentMap((done, total) => {
    if (done % 20 === 0 || done === total) console.log(`  progress: ${done}/${total}`);
  });

  console.log(`\nMapped ${result.upserted} US-listed ISINs to Finnhub symbols.`);
  if (result.unmatchedIsins.length > 0) {
    console.log(`${result.unmatchedIsins.length} ISINs had no Finnhub match:`);
    for (const isin of result.unmatchedIsins) console.log(`  - ${isin}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Foreign instrument sync failed:", err);
    process.exit(1);
  });
