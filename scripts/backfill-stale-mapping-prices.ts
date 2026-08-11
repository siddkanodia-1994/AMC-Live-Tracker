// One-off (rerunnable) backfill for ISINs whose isin_daily_price history
// went stale because their DHAN security ID was wrong for a stretch of
// time -- run this right after correcting instrument_map (see
// syncInstrumentMap / the admin "Sync Instruments" action) to also fix
// the historical prices that were frozen while the mapping was broken.
// Confirmed 2026-08-10: these 6 ISINs had stale NSE security IDs
// (DHAN had reissued new ones since our last sync on 16 Jul).
import { db } from "../src/lib/db/client";
import { instrumentMap } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";
import { backfillIsinPriceHistory, STALE_MAPPING_BACKFILL_LOOKBACK_DAYS } from "../src/lib/aum/isin-price-backfill";
import type { ExchangeSegment } from "../src/lib/dhan/types";

const ISINS_TO_BACKFILL = [
  "INE989C01038", // Diamond Power Infrastructure Ltd.
  "INE510W01014", // Inox Green Energy Services Ltd.
  "INE0LR101013", // Anlon Technology Solution Ltd.
  "INE0AE001013", // Vishnu Prakash R Punglia Ltd.
  "INE1YPB01014", // Allcargo Global Ltd.
  "INE290A01027", // Nahar Spinning Mills Ltd.
];

async function main() {
  for (const isin of ISINS_TO_BACKFILL) {
    const [mapping] = await db.select().from(instrumentMap).where(eq(instrumentMap.isin, isin));
    if (!mapping) {
      console.log(`${isin}: no instrument_map row found, skipping`);
      continue;
    }

    console.log(`\n${isin} (securityId=${mapping.securityId}, segment=${mapping.exchangeSegment}):`);
    const { datesUpdated } = await backfillIsinPriceHistory(
      isin,
      mapping.securityId,
      mapping.exchangeSegment as ExchangeSegment,
      STALE_MAPPING_BACKFILL_LOOKBACK_DAYS
    );
    console.log(`  ${datesUpdated.length} date(s) updated: ${datesUpdated.join(", ")}`);
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
