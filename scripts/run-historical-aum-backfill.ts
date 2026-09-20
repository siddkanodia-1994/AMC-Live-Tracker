// Runs computeHistoricalAumEstimates for every amc_listed_stock AMC and
// prints a verification summary. Run AFTER both seed scripts
// (seed-historical-aum-anchors.ts, seed-historical-amc-share-prices.ts) --
// the price seed must run first, since the AUM computation truncates each
// AMC's output to its own earliest real share price date.
import { db } from "../src/lib/db/client";
import { amcs, amcListedStock, amcHistoricalAumAnchor } from "../src/lib/db/schema";
import { computeHistoricalAumEstimates } from "../src/lib/aum/historical-backfill";
import { eq } from "drizzle-orm";

async function main() {
  const listedStocks = await db
    .select({ amcId: amcListedStock.amcId, slug: amcs.slug, overviewName: amcs.overviewName })
    .from(amcListedStock)
    .innerJoin(amcs, eq(amcListedStock.amcId, amcs.id));

  for (const amc of listedStocks) {
    const result = await computeHistoricalAumEstimates(amc.amcId);
    console.log(`\n${amc.overviewName} (${amc.slug}):`);
    console.log(`  anchors=${result.anchorsUsed} segments=${result.segmentsComputed} rowsWritten=${result.rowsWritten}`);
    console.log(`  range=${result.firstWrittenDate ?? "—"} .. ${result.lastWrittenDate ?? "—"} priceFloor=${result.priceFloorDate ?? "—"}`);
    for (const w of result.warnings) console.log(`  WARNING: ${w}`);

    if (result.rowsWritten > 0) {
      const anchors = await db
        .select()
        .from(amcHistoricalAumAnchor)
        .where(eq(amcHistoricalAumAnchor.amcId, amc.amcId))
        .orderBy(amcHistoricalAumAnchor.monthEndDate);
      const finalAnchor = anchors[anchors.length - 1];
      console.log(`  final anchor (${finalAnchor.reportMonth}): ${finalAnchor.exitAumCr} cr`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Historical AUM backfill run failed:", err);
    process.exit(1);
  });
