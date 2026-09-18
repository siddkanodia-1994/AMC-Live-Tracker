// One-off/reviewable seed for amc_listed_stock: which AMCs' own
// asset-management BUSINESS is itself a separately-listed company, and
// which stock that is. Verified directly against DHAN's own public
// detailed instrument master (api-scrip-master-detailed.csv) on
// 2026-09-18 -- all 7 confirmed real, NSE-listed companies (not assumed).
// Also seeds instrument_map for these ISINs directly (rather than relying
// on syncInstrumentMap()'s bulk resync, whose scope over non-holding
// ISINs isn't confirmed) so runAmcStockIngestion() has a mapping to read
// from immediately. Re-run this script (with an added row) to bring a
// newly-listed AMC into this feature -- no code change needed elsewhere.
import { db } from "../src/lib/db/client";
import { amcs, amcListedStock, instrumentMap } from "../src/lib/db/schema";
import { eq } from "drizzle-orm";

interface SeedRow {
  amcSlug: string;
  isin: string;
  securityId: string;
  tradingSymbol: string;
  backfillFromDate: string;
}

const LISTED_STOCKS: SeedRow[] = [
  { amcSlug: "hdfc-mutual-fund", isin: "INE127D01025", securityId: "4244", tradingSymbol: "HDFCAMC", backfillFromDate: "2026-01-01" },
  { amcSlug: "canara-robeco-mutual-fund", isin: "INE218I01013", securityId: "759311", tradingSymbol: "CRAMC", backfillFromDate: "2026-01-01" },
  { amcSlug: "nippon-india-mutual-fund", isin: "INE298J01013", securityId: "357", tradingSymbol: "NAM-INDIA", backfillFromDate: "2026-01-01" },
  { amcSlug: "aditya-birla-sun-life-mutual-fund", isin: "INE404A01024", securityId: "6018", tradingSymbol: "ABSLAMC", backfillFromDate: "2026-01-01" },
  { amcSlug: "uti-mutual-fund", isin: "INE094J01016", securityId: "527", tradingSymbol: "UTIAMC", backfillFromDate: "2026-01-01" },
  { amcSlug: "sbi-mutual-fund", isin: "INE640G01020", securityId: "764173", tradingSymbol: "SBIFUNDS", backfillFromDate: "2026-01-01" },
  { amcSlug: "icici-prudential-mutual-fund", isin: "INE346A01027", securityId: "760407", tradingSymbol: "ICICIAMC", backfillFromDate: "2026-01-01" },
];

async function main() {
  let seeded = 0;
  for (const row of LISTED_STOCKS) {
    const [amc] = await db.select().from(amcs).where(eq(amcs.slug, row.amcSlug));
    if (!amc) {
      console.error(`No amcs row found for slug "${row.amcSlug}" -- skipped.`);
      continue;
    }

    await db
      .insert(instrumentMap)
      .values({ isin: row.isin, securityId: row.securityId, exchangeSegment: "NSE_EQ", tradingSymbol: row.tradingSymbol })
      .onConflictDoUpdate({
        target: instrumentMap.isin,
        set: { securityId: row.securityId, exchangeSegment: "NSE_EQ", tradingSymbol: row.tradingSymbol, updatedAt: new Date() },
      });

    await db
      .insert(amcListedStock)
      .values({ amcId: amc.id, isin: row.isin, tradingSymbol: row.tradingSymbol, backfillFromDate: row.backfillFromDate })
      .onConflictDoUpdate({
        target: amcListedStock.amcId,
        set: { isin: row.isin, tradingSymbol: row.tradingSymbol, backfillFromDate: row.backfillFromDate },
      });
    seeded++;
  }
  console.log(`Seeded ${seeded} AMC listed-stock mapping(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("AMC listed-stock seed failed:", err);
    process.exit(1);
  });
