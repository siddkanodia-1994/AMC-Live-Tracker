import { refreshForeignPrices } from "../src/lib/aum/foreign-pricing";

async function main() {
  const result = await refreshForeignPrices((done, total) => {
    if (done % 20 === 0 || done === total) console.log(`  progress: ${done}/${total}`);
  });

  console.log(`\nUpdated ${result.updated} US-listed holding prices, ${result.failed} failed.`);
  console.log(`USD/INR rate: ${result.usdInrRate ?? "unavailable — kept previous cached rate"}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Foreign price refresh failed:", err);
    process.exit(1);
  });
