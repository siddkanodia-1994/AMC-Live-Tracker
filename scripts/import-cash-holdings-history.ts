// Run monthly, after each new tracker file is uploaded: parses that
// workbook's "Cash Holdings" sheet, column K block (the genuine
// one-row-per-AMC "CCE % of AUM - AMC wise" table -- confirmed distinct
// from the scheme-specific breakdowns further right in the same sheet)
// and persists it to official_cce_history. The sheet embeds a rolling
// 6-month window (e.g. Jan-26..Jun-26 in June's file), so a single run
// backfills/refreshes up to 6 months at once. Uses fs.readFileSync +
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
import { getAmcMap } from "../src/lib/excel/amc-name-map";

const FILE_PATH = process.argv[2];
const SHEET_NAME = "Cash Holdings";
const NAME_COL = 10; // column K, 0-indexed
const HEADER_ROW = 6; // 0-indexed: month labels (a rolling 6-month window)
const DATA_START_ROW = 7; // 0-indexed: first real AMC row ("360 ONE")
const MONTH_COLS_START = 11; // column L
const MONTH_COLS_END = 16; // column Q

const MONTH_ABBR: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseMonthLabel(label: string): string {
  const [abbr, yy] = label.trim().split("-");
  const mm = MONTH_ABBR[abbr?.toLowerCase()];
  if (!mm || !yy) throw new Error(`Unrecognized month label: "${label}"`);
  return `20${yy}-${mm}`;
}

async function main() {
  if (!FILE_PATH) {
    throw new Error("Usage: npx tsx scripts/import-cash-holdings-history.ts <path-to-xlsx>");
  }
  const buf = fs.readFileSync(FILE_PATH);
  const wb = xlsx.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found in workbook`);
  const rows: unknown[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  const headerRow = rows[HEADER_ROW];
  const months: string[] = [];
  for (let col = MONTH_COLS_START; col <= MONTH_COLS_END; col++) {
    const label = headerRow?.[col];
    if (typeof label !== "string") {
      throw new Error(`Expected a month label at row ${HEADER_ROW}, col ${col} — got ${JSON.stringify(label)}. Sheet layout may have shifted.`);
    }
    months.push(parseMonthLabel(label));
  }
  console.log(`Months found: ${months.join(", ")}`);

  const map = getAmcMap();
  const sheetNameToEntry = new Map(map.map((e) => [e.sheetName.trim().toLowerCase(), e]));

  const allAmcs = await db.select().from(amcs);
  const slugToAmcId = new Map(allAmcs.map((a) => [a.slug, a.id]));

  const rowsToInsert: (typeof officialCceHistory.$inferInsert)[] = [];
  const unmatched: string[] = [];
  let amcRowCount = 0;

  // Data end row is detected dynamically -- not a fixed row count, since
  // the AMC list grows over time (confirmed: June's sheet added a row past
  // what May's fixed DATA_END_ROW=62 would have covered, silently dropping
  // it under the old hardcoded-range version of this script). Scans to the
  // last row with a name in NAME_COL, then iterates that full span --
  // preserves the original tolerance for a blank spacer row *within* the
  // block (skipped via `continue`, not treated as the end).
  let dataEndRow = DATA_START_ROW - 1;
  for (let r = DATA_START_ROW; r < rows.length; r++) {
    const v = rows[r]?.[NAME_COL];
    if (v !== null && v !== undefined && String(v).trim() !== "") dataEndRow = r;
  }

  for (let r = DATA_START_ROW; r <= dataEndRow; r++) {
    const rawName = rows[r]?.[NAME_COL];
    if (rawName === null || rawName === undefined || String(rawName).trim() === "") continue;
    amcRowCount++;
    const name = String(rawName).trim();
    const entry = sheetNameToEntry.get(name.toLowerCase());
    if (!entry) {
      unmatched.push(name);
      continue;
    }
    const amcId = slugToAmcId.get(entry.slug);
    if (!amcId) {
      unmatched.push(`${name} (mapped to slug "${entry.slug}" but no such AMC in DB)`);
      continue;
    }

    for (let i = 0; i < months.length; i++) {
      const rawPct = rows[r]?.[MONTH_COLS_START + i];
      if (typeof rawPct !== "number") continue;
      rowsToInsert.push({ amcId, month: months[i], ccePct: String(rawPct) });
    }
  }

  console.log(`\nFound ${amcRowCount} AMC rows in the sheet.`);
  if (unmatched.length > 0) {
    console.log(`WARNING: ${unmatched.length} rows could not be matched to an AMC and were skipped:`);
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

  console.log(`Done. ${rowsToInsert.length} rows upserted across ${months.length} months for ${amcRowCount - unmatched.length} AMCs.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
