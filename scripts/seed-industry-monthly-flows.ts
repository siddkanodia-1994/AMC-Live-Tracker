// One-off historical backfill for the Summary tab's "Industry Flows" panel
// -- reads the user-supplied AMFI workbook (125 monthly rows, Apr 2016-Aug
// 2026: Month-end date, SIP contributions, Equity net flows) and upserts
// them via the SAME upsertMonthlyFlow() the new Admin form uses for routine
// monthly updates going forward -- one write path, not two. Safe to re-run
// (upsert by month). Bulk Flows is intentionally not read from the sheet's
// own Bulk column -- it's always computed as netFlow - sip (verified exact
// on every sampled row) -- this script just sanity-checks that equivalence
// as a warning, not a hard failure, in case of a data-entry typo somewhere
// in the source file.
import * as XLSX from "xlsx";
import { upsertMonthlyFlow } from "../src/lib/aum/industry-flows";

const WORKBOOK_PATH = "./Monthly_SIP_and_Net_Flows_Apr2016_Aug2026.xlsx";
const SHEET_NAME = "Monthly data (2)";
const HEADER_ROW_INDEX = 6; // 0-based; Excel row 7

function excelSerialToISO(serial: number): string {
  const utcDays = Math.floor(serial - 25569);
  return new Date(utcDays * 86400 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const workbook = XLSX.readFile(WORKBOOK_PATH);
  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found in ${WORKBOOK_PATH}`);

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const header = rows[HEADER_ROW_INDEX];
  if (!header || !String(header[0]).startsWith("Month-end")) {
    throw new Error(`Expected a "Month-end" header at row ${HEADER_ROW_INDEX + 1}, got: ${JSON.stringify(header)}`);
  }

  const dataRows = rows.slice(HEADER_ROW_INDEX + 1).filter((r) => r && r[0] != null);
  console.log(`Found ${dataRows.length} data rows in "${SHEET_NAME}".`);

  let written = 0;
  let mismatchWarnings = 0;
  for (const row of dataRows) {
    const rawDate = row[0];
    const monthEndDate = typeof rawDate === "number" ? excelSerialToISO(rawDate) : String(rawDate).slice(0, 10);
    const sip = Number(row[1]);
    const netFlow = Number(row[3]);
    const sheetBulk = row[5] !== null && row[5] !== undefined ? Number(row[5]) : null;

    if (!Number.isFinite(sip) || !Number.isFinite(netFlow)) {
      console.warn(`  skipped ${monthEndDate}: non-numeric SIP/Net Flow (${row[1]}, ${row[3]})`);
      continue;
    }

    const computedBulk = netFlow - sip;
    if (sheetBulk !== null && Number.isFinite(sheetBulk) && Math.abs(sheetBulk - computedBulk) > 0.5) {
      mismatchWarnings++;
      console.warn(
        `  WARNING ${monthEndDate}: sheet Bulk (${sheetBulk}) != netFlow-sip (${computedBulk.toFixed(2)})`
      );
    }

    await upsertMonthlyFlow(monthEndDate, sip, netFlow);
    written++;
  }

  console.log(`\nUpserted ${written} rows. ${mismatchWarnings} Bulk mismatch warning(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Industry monthly flows seed failed:", err);
    process.exit(1);
  });
