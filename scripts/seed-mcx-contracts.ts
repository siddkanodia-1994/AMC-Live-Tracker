// One-off/reviewable seed for mcx_tracked_contract: which MCX futures
// contract currently stands in for "the price of gold/silver" on the
// Gold & Silver ETFs tab's MCX reference rows. Verified directly against
// DHAN's own public instrument master (api-scrip-master-detailed.csv,
// exchange MCX, instrument FUTCOM) -- front-month per metal, per the
// user's explicit choice. Re-run this script (with updated values) when
// a tracked contract is nearing its expiryDate; runMcxIngestion() only
// warns in logs, it never rewrites this table itself.
//
// Gold rolled 2026-10-21: the prior contract (GOLD-05Oct2026-FUT,
// security 483079) expired 2026-10-05 and was never rolled, so the Gold
// reference row had been silently serving a ~3-week-stale frozen price as
// "live" -- found during a full pipeline audit. securityId 495213
// confirmed against the instrument master as MCX's GOLD DEC FUT contract
// (the same Dec-2026 expiry Silver is already correctly tracking).
//
// Rolled 2026-11-27, a week before both Dec contracts expire (2026-12-04),
// to the next front months in DHAN's instrument master (MCX, FUTCOM):
// GOLD FEB FUT 559933 (expires 2027-02-05) and SILVER MAR FUT 564619
// (expires 2027-03-05). The probe's mcx-freshness check now warns 7 days
// before expiry, so the next roll shows up on the Agent Ops panel.
import { db } from "../src/lib/db/client";
import { mcxTrackedContract } from "../src/lib/db/schema";

interface SeedRow {
  metal: "gold" | "silver";
  securityId: string;
  tradingSymbol: string;
  expiryDate: string;
}

const CONTRACTS: SeedRow[] = [
  { metal: "gold", securityId: "559933", tradingSymbol: "GOLD-05Feb2027-FUT", expiryDate: "2027-02-05" },
  { metal: "silver", securityId: "564619", tradingSymbol: "SILVER-05Mar2027-FUT", expiryDate: "2027-03-05" },
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
