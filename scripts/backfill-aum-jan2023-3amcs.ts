// One-off, AUM-only backfill closing the remaining gap for ICICI
// Prudential / Canara Robeco / SBI Mutual Fund: their amc_historical_aum_
// estimate rows previously started 2024-04-01 (see
// scripts/backfill-aum-apr2024-3amcs.ts), even though
// amc_historical_aum_anchor already has monthly ground truth back to
// 2022-12-30 for all three -- identical coverage to HDFC and the other 5
// AMCs (confirmed 2026-10 via direct DB audit). This fills 2023-01-01
// through 2024-03-31 so these 3 AMCs' daily AUM history now starts
// 2023-01-02, matching the other 5 exactly -- same ignorePriceFloor
// mechanism as the two prior scripts (these AMCs' own stocks listed much
// later: Canara Oct 2025, ICICI Dec 2025, SBI Jul 2026, so the AUM-only
// estimate has no price to compare against this far back, which is fine
// for AUM-only consumers like the Stock Correlation and Regression tabs'
// moving averages).
import { db } from "../src/lib/db/client";
import { amcs, amcListedStock, amcHistoricalAumEstimate } from "../src/lib/db/schema";
import { computeHistoricalAumEstimates } from "../src/lib/aum/historical-backfill";
import { and, asc, between, eq } from "drizzle-orm";

const TARGET_SLUGS = ["icici-prudential-mutual-fund", "canara-robeco-mutual-fund", "sbi-mutual-fund"];
const MIN_DATE = "2023-01-01";
const MAX_DATE = "2024-03-31";

async function main() {
  const targets = await db
    .select({ amcId: amcListedStock.amcId, slug: amcs.slug, overviewName: amcs.overviewName })
    .from(amcListedStock)
    .innerJoin(amcs, eq(amcListedStock.amcId, amcs.id));

  for (const slug of TARGET_SLUGS) {
    const amc = targets.find((t) => t.slug === slug);
    if (!amc) {
      console.log(`\n${slug}: no amc_listed_stock row found -- skipped.`);
      continue;
    }

    const before = await db
      .select()
      .from(amcHistoricalAumEstimate)
      .where(and(eq(amcHistoricalAumEstimate.amcId, amc.amcId), between(amcHistoricalAumEstimate.snapshotDate, MIN_DATE, MAX_DATE)));

    console.log(`\n${amc.overviewName} (${amc.slug}):`);
    console.log(`  before: ${before.length} rows already in [${MIN_DATE}, ${MAX_DATE}]`);

    const result = await computeHistoricalAumEstimates(amc.amcId, {
      ignorePriceFloor: true,
      minDate: MIN_DATE,
      maxDate: MAX_DATE,
    });
    console.log(`  anchors=${result.anchorsUsed} segments=${result.segmentsComputed} rowsWritten=${result.rowsWritten}`);
    console.log(`  range=${result.firstWrittenDate ?? "—"} .. ${result.lastWrittenDate ?? "—"} (real priceFloor=${result.priceFloorDate ?? "—"}, ignored)`);
    for (const w of result.warnings) console.log(`  WARNING: ${w}`);

    const after = await db
      .select()
      .from(amcHistoricalAumEstimate)
      .where(and(eq(amcHistoricalAumEstimate.amcId, amc.amcId), between(amcHistoricalAumEstimate.snapshotDate, MIN_DATE, MAX_DATE)))
      .orderBy(asc(amcHistoricalAumEstimate.snapshotDate));
    console.log(`  after: ${after.length} rows in [${MIN_DATE}, ${MAX_DATE}]`);
    if (after.length > 0) {
      console.log(`  sample: ${after[0].snapshotDate}=${after[0].estimatedAumCr}cr  ${after[Math.floor(after.length / 2)].snapshotDate}=${after[Math.floor(after.length / 2)].estimatedAumCr}cr  ${after[after.length - 1].snapshotDate}=${after[after.length - 1].estimatedAumCr}cr`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Jan 2023 AUM backfill run failed:", err);
    process.exit(1);
  });
