// One-off backfill for the two index keys added alongside Nifty 50/500:
// Nifty Midcap 150 and Nifty Smallcap 250. Unlike backfill-index-levels.ts,
// no external-JSON bootstrap is needed -- confirmed directly against DHAN
// that its historical/charts endpoint has full daily closes for both back
// to 2026-01-01 (the app's own earliest history), so a single DHAN fetch
// per index covers the whole range.
import { fetchHistoricalCloses } from "../src/lib/dhan/historical-client";
import { INDEX_SECURITY_IDS, type IndexKey } from "../src/lib/dhan/indices";
import { writeIndexDailyLevelRows, type IndexDailyLevelRow } from "../src/lib/aum/index-level-store";
import { yesterdayIst } from "../src/lib/aum/backfill";

const NEW_INDEX_KEYS: IndexKey[] = ["NIFTY_MIDCAP_150", "NIFTY_SMALLCAP_250"];
const FROM_DATE = "2026-01-01";

async function main() {
  const toDate = yesterdayIst();
  console.log(`Backfilling ${NEW_INDEX_KEYS.join(", ")} from ${FROM_DATE} to ${toDate}`);

  const rows: IndexDailyLevelRow[] = [];
  for (const indexKey of NEW_INDEX_KEYS) {
    const securityId = INDEX_SECURITY_IDS[indexKey];
    const closes = await fetchHistoricalCloses(securityId, "IDX_I", FROM_DATE, toDate, "INDEX");
    console.log(`  ${indexKey}: ${closes.length} closes fetched from DHAN`);
    for (const c of closes) {
      rows.push({ indexKey, snapshotDate: c.date, levelValue: c.close });
    }
  }

  await writeIndexDailyLevelRows(rows);
  console.log(`Done. Total rows written: ${rows.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("New index-level backfill failed:", err);
    process.exit(1);
  });
