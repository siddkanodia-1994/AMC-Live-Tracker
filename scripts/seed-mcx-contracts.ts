// One-off/reviewable seed for mcx_tracked_contract: which MCX futures
// contract currently stands in for "the price of gold/silver" on the
// Gold & Silver ETFs tab's MCX reference rows. Verified directly against
// DHAN's own public instrument master (api-scrip-master.csv, exchange
// MCX, instrument FUTCOM) on 2026-09-08 -- front-month per metal, per the
// user's explicit choice. Re-run this script (with updated values) when
// a tracked contract is nearing its expiryDate; runMcxIngestion() only
// warns in logs, it never rewrites this table itself.
import { db } from "../src/lib/db/client";
import { mcxTrackedContract } from "../src/lib/db/schema";

interface SeedRow {
  metal: "gold" | "silver";
  securityId: string;
  tradingSymbol: string;
  expiryDate: string;
}

const CONTRACTS: SeedRow[] = [
  { metal: "gold", securityId: "483079", tradingSymbol: "GOLD-05Oct2026-FUT", expiryDate: "2026-10-05" },
  { metal: "silver", securityId: "495214", tradingSymbol: "SILVER-04Dec2026-FUT", expiryDate: "2026-12-04" },
];

async function main() {
  for (const row of CONTRACTS) {
    await db
      .insert(mcxTrackedContract)
      .values(row)
      .onConflictDoUpdate({
        target: mcxTrackedContract.metal,
        set: { securityId: row.securityId, tradingSymbol: row.tradingSymbol, expiryDate: row.expiryDate },
      });
  }
  console.log(`Seeded ${CONTRACTS.length} MCX tracked contracts.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("MCX contract seed failed:", err);
    process.exit(1);
  });
