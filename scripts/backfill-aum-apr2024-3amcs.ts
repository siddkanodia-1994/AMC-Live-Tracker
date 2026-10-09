// One-off, AUM-only backfill extending ICICI Prudential / Canara Robeco /
// SBI Mutual Fund's historical AUM estimates back to 1 Apr 2024 (was
// 1 Jan 2025 -- see scripts/backfill-aum-jan2025-amcs.ts). Confirmed 2026-10
// that amc_historical_aum_anchor already has rows back to Dec 2022 for all
// three, so the only reason this window wasn't written before is that the
// prior script's own MIN_DATE deliberately stopped at 2025-01-01 (it was
// scoped narrowly). This fills Apr-Dec 2024 (the data needed for a true
// full-year FY2025, so FY2026's own YoY%% can be computed against a real
// full year rather than a 3-month stub) and re-covers the already-written
// Jan 2025-Dec 2025 window in the same call -- harmless and idempotent,
// since the per-day math only depends on the anchor pair and the NIFTY_500
// index level for that day, neither of which changed.
import { db } from "../src/lib/db/client";
import { amcs, amcListedStock, amcHistoricalAumEstimate } from "../src/lib/db/schema";
import { computeHistoricalAumEstimates } from "../src/lib/aum/historical-backfill";
import { and, asc, between, eq } from "drizzle-orm";

const TARGET_SLUGS = ["icici-prudential-mutual-fund", "canara-robeco-mutual-fund", "sbi-mutual-fund"];
const MIN_DATE = "2024-04-01";
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
    console.error("Apr 2024 AUM backfill run failed:", err);
    process.exit(1);
  });
