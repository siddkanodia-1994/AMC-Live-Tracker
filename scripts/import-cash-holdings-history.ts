// Manual recovery/backfill tool: parses one workbook's "Cash Holdings"
// sheet and persists it to official_cce_history, sharing the exact same
// parser as the automatic path folded into importWorkbook() (see
// src/lib/excel/parse-cash-holdings.ts) so the two can never drift. Useful
// for re-running against a single historical month (e.g. a corrected file)
// without redoing the whole holdings/AUM import. Uses fs.readFileSync +
// xlsx.read(buf) rather than xlsx.readFile(path): the source file's
// -r-------- permissions reject the latter's internal file-access check
// even though the former reads it fine. Safe to re-run (upserts on
// amcId+month).
//
// Usage: npx tsx scripts/import-cash-holdings-history.ts <path-to-xlsx>
import fs from "fs";
import * as xlsx from "xlsx";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { amcs, officialCceHistory } from "../src/lib/db/schema";
import { parseCashHoldingsSheet } from "../src/lib/excel/parse-cash-holdings";

const FILE_PATH = process.argv[2];

async function main() {
  if (!FILE_PATH) {
    throw new Error("Usage: npx tsx scripts/import-cash-holdings-history.ts <path-to-xlsx>");
  }
  const buf = fs.readFileSync(FILE_PATH);
  const wb = xlsx.read(buf, { type: "buffer" });

  const { rows, warnings } = parseCashHoldingsSheet(wb);
  for (const w of warnings) console.log(`WARNING: ${w}`);
  if (rows.length === 0) {
    console.log("No rows parsed -- nothing to upsert.");
    process.exit(warnings.length > 0 ? 1 : 0);
  }

  const months = [...new Set(rows.map((r) => r.month))].sort();
  console.log(`Months found: ${months.join(", ")}`);

  const allAmcs = await db.select().from(amcs);
  const sheetNameToAmcId = new Map(allAmcs.map((a) => [a.sheetName.trim().toLowerCase(), a.id]));

  const rowsToInsert: (typeof officialCceHistory.$inferInsert)[] = [];
  const unmatched = new Set<string>();
  for (const row of rows) {
    const amcId = sheetNameToAmcId.get(row.sheetName.trim().toLowerCase());
    if (!amcId) {
      unmatched.add(row.sheetName);
      continue;
    }
    rowsToInsert.push({ amcId, month: row.month, ccePct: String(row.ccePct) });
  }

  if (unmatched.size > 0) {
    console.log(`WARNING: ${unmatched.size} row(s) could not be matched to an AMC and were skipped:`);
    for (const u of unmatched) console.log(`  - ${u}`);
  } else {
    console.log("All rows matched an AMC.");
  }

  console.log(`\nUpserting ${rowsToInsert.length} (amc, month) CCE% rows...`);
  const BATCH_SIZE = 500;
  for (let i = 0; i < rowsToInsert.length; i += BATCH_SIZE) {
    const batch = rowsToInsert.slice(i, i + BATCH_SIZE);
    await db
      .insert(officialCceHistory)
      .values(batch)
      .onConflictDoUpdate({
        target: [officialCceHistory.amcId, officialCceHistory.month],
        set: { ccePct: sql`excluded.cce_pct`, importedAt: sql`now()` },
      });
  }

  console.log(`Done. ${rowsToInsert.length} rows upserted across ${months.length} months.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
