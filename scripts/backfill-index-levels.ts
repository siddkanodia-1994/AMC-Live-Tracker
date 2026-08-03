import { readFileSync } from "fs";
import { fetchHistoricalCloses } from "../src/lib/dhan/historical-client";
import { INDEX_KEYS, INDEX_SECURITY_IDS } from "../src/lib/dhan/indices";
import { writeIndexDailyLevelRows, type IndexDailyLevelRow } from "../src/lib/aum/index-level-store";
import { yesterdayIst } from "../src/lib/aum/backfill";

// One-time bootstrap source: a sibling, separately-deployed Vercel project
// ("Nifty Macro") that already tracks 15 NSE indices' EOD closes in a
// static JSON file rebuilt daily by its own GitHub Action. Read-only --
// nothing in that repo is ever touched or modified by this script. Its own
// cron has been stalled since 2026-07-17 (confirmed via that repo's git
// history), so this is a one-time historical seed, not an ongoing
// dependency -- everything after its last date is filled from DHAN below.
const NIFTY_MACRO_HISTORICAL_JSON =
  process.argv[2] ??
  "/Users/siddhantkanodia/Documents/Claude Working Folder/Macro Dashboard/nifty-macro-dashboard/data/historical.json";

interface NiftyMacroRow {
  date: string;
  NIFTY_50?: { close: number };
  NIFTY_500?: { close: number };
}

async function main() {
  console.log(`Reading Nifty Macro bootstrap file: ${NIFTY_MACRO_HISTORICAL_JSON}`);
  const raw = readFileSync(NIFTY_MACRO_HISTORICAL_JSON, "utf-8");
  const rows: NiftyMacroRow[] = JSON.parse(raw);

  const bootstrapRows: IndexDailyLevelRow[] = [];
  let lastBootstrapDate = "";
  for (const row of rows) {
    if (row.NIFTY_50?.close != null) {
      bootstrapRows.push({ indexKey: "NIFTY_50", snapshotDate: row.date, levelValue: row.NIFTY_50.close });
    }
    if (row.NIFTY_500?.close != null) {
      bootstrapRows.push({ indexKey: "NIFTY_500", snapshotDate: row.date, levelValue: row.NIFTY_500.close });
    }
    if (row.date > lastBootstrapDate) lastBootstrapDate = row.date;
  }
  console.log(`Bootstrap: ${bootstrapRows.length} rows through ${lastBootstrapDate}`);
  await writeIndexDailyLevelRows(bootstrapRows);

  const gapStart = new Date(`${lastBootstrapDate}T00:00:00Z`);
  gapStart.setUTCDate(gapStart.getUTCDate() + 1);
  const fromDate = gapStart.toISOString().slice(0, 10);
  const toDate = yesterdayIst();

  if (fromDate > toDate) {
    console.log(`No DHAN gap-fill needed -- bootstrap already covers through ${lastBootstrapDate}.`);
    console.log("Done.");
    return;
  }

  console.log(`DHAN gap-fill: ${fromDate} to ${toDate}`);
  const gapRows: IndexDailyLevelRow[] = [];
  for (const indexKey of INDEX_KEYS) {
    const securityId = INDEX_SECURITY_IDS[indexKey];
    const closes = await fetchHistoricalCloses(securityId, "IDX_I", fromDate, toDate, "INDEX");
    console.log(`  ${indexKey}: ${closes.length} closes fetched from DHAN`);
    for (const c of closes) {
      gapRows.push({ indexKey, snapshotDate: c.date, levelValue: c.close });
    }
  }
  await writeIndexDailyLevelRows(gapRows);

  console.log(`Done. Total rows written: ${bootstrapRows.length + gapRows.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Index-level backfill failed:", err);
    process.exit(1);
  });
