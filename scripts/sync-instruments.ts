import { syncInstrumentMap } from "../src/lib/dhan/instrument-master";

async function main() {
  const result = await syncInstrumentMap();
  console.log(`Upserted ${result.upserted} instrument mappings.`);
  if (result.unmatchedIsins.length > 0) {
    console.log(`\n${result.unmatchedIsins.length} priceable ISINs had no match in DHAN's instrument master:`);
    for (const isin of result.unmatchedIsins) console.log(`  - ${isin}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Instrument sync failed:", err);
    process.exit(1);
  });
