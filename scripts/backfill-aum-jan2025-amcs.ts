// One-off, AUM-only backfill for ICICI Prudential / Canara Robeco / SBI
// Mutual Fund covering exactly Jan-Dec 2025 -- confirmed 2026-10 that the
// required amc_historical_aum_anchor (monthly ground truth) and
// index_daily_level (NIFTY_500) data already fully exist for this window;
// the only reason these 3 AMCs didn't already have estimate rows here is
// computeHistoricalAumEstimates()'s own price-floor truncation (no real
// share price exists this far back for these AMCs -- Canara/ICICI listed
// late 2025, SBI mid-2026). Deliberately NOT touching
// run-historical-aum-backfill.ts (the other 5 AMCs' own normal invocation
// stays completely untouched) -- this is a separate, narrower, opt-in
// relaxation of that one truncation rule for exactly these 3 AMCs/this one
// window, per explicit user confirmation that this data is for AUM-only
// views (the Summary tab) which have no share-price dependency at all.
import { db } from "../src/lib/db/client";
import { amcs, amcListedStock, amcHistoricalAumEstimate } from "../src/lib/db/schema";
import { computeHistoricalAumEstimates } from "../src/lib/aum/historical-backfill";
import { and, asc, between, eq } from "drizzle-orm";

const TARGET_SLUGS = ["icici-prudential-mutual-fund", "canara-robeco-mutual-fund", "sbi-mutual-fund"];
const MIN_DATE = "2025-01-01";
const MAX_DATE = "2025-12-31";

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
    console.error("Jan 2025 AUM backfill run failed:", err);
    process.exit(1);
  });
