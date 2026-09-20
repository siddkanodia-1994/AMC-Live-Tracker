// One-off seed for amc_historical_aum_anchor: parses the user-provided
// "Monthly Equity AUM" sheet (HDFC_and_7_AMC_Monthly_Equity_AUM.xlsx) into
// each of the 8 amc_listed_stock AMCs' monthly exit equity AUM, Dec-2022
// through Dec-2025 -- the ground truth the historical backfill
// (src/lib/aum/historical-backfill.ts) compounds NIFTY_500's daily return
// between. Each month's date cell is a day-1 label (e.g. "2022-12-01"
// means "December 2022's exit AUM", not literally Dec 1); the actual
// month-end trading date is resolved separately via
// resolveMonthEndTradingDate (index_daily_level doubles as the trading
// calendar here, since no 2023-2025 holiday list exists in this codebase).
// Safe to re-run -- upserts on (amcId, reportMonth).
import * as XLSX from "xlsx";
import { db } from "../src/lib/db/client";
import { amcs, amcHistoricalAumAnchor } from "../src/lib/db/schema";
import { resolveMonthEndTradingDate } from "../src/lib/aum/historical-backfill";
import { lastDayOfReportMonth } from "../src/lib/aum/report-period";
import { eq } from "drizzle-orm";

const WORKBOOK_PATH = "/Users/siddhantkanodia/Documents/Claude Working Folder/AMC -Dashboard/HDFC_and_7_AMC_Monthly_Equity_AUM.xlsx";
const SHEET_NAME = "Monthly Equity AUM";
const HEADER_ROW_INDEX = 3; // 0-indexed; row 4 in Excel

// Sheet column header -> amcSlug. Column order in the sheet isn't
// guaranteed stable, so this is matched by header text, not position.
const COLUMN_TO_SLUG: Record<string, string> = {
  "HDFC Mutual Fund": "hdfc-mutual-fund",
  "Canara Robeco": "canara-robeco-mutual-fund",
  "Aditya Birla Sun Life": "aditya-birla-sun-life-mutual-fund",
  "ICICI Prudential": "icici-prudential-mutual-fund",
  "Nippon India": "nippon-india-mutual-fund",
  "Motilal Oswal": "motilal-oswal-mutual-fund",
  "UTI Mutual Fund": "uti-mutual-fund",
  "SBI Mutual Fund": "sbi-mutual-fund",
};

function excelSerialToISO(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

interface AnchorRow {
  amcSlug: string;
  reportMonth: string; // "YYYY-MM"
  exitAumCr: number;
}

function parseWorkbook(): AnchorRow[] {
  const wb = XLSX.readFile(WORKBOOK_PATH);
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found in ${WORKBOOK_PATH}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];

  const header = rows[HEADER_ROW_INDEX] as (string | null)[];
  const colIndexToSlug = new Map<number, string>();
  header.forEach((label, i) => {
    if (label && COLUMN_TO_SLUG[label]) colIndexToSlug.set(i, COLUMN_TO_SLUG[label]);
  });
  const missing = Object.keys(COLUMN_TO_SLUG).filter((label) => !header.includes(label));
  if (missing.length > 0) throw new Error(`Header row missing expected column(s): ${missing.join(", ")}`);

  const anchors: AnchorRow[] = [];
  for (let r = HEADER_ROW_INDEX + 1; r < rows.length; r++) {
    const row = rows[r];
    const dateSerial = row[0];
    if (typeof dateSerial !== "number") continue;
    const reportMonth = excelSerialToISO(dateSerial).slice(0, 7); // "YYYY-MM"
    for (const [colIndex, amcSlug] of colIndexToSlug) {
      const value = row[colIndex];
      if (typeof value !== "number") continue;
      anchors.push({ amcSlug, reportMonth, exitAumCr: value });
    }
  }
  return anchors;
}

async function main() {
  const anchors = parseWorkbook();
  console.log(`Parsed ${anchors.length} anchor(s) from the workbook (expect 8 AMCs x 37 months = 296).`);

  let seeded = 0;
  for (const row of anchors) {
    const [amc] = await db.select().from(amcs).where(eq(amcs.slug, row.amcSlug));
    if (!amc) {
      console.error(`No amcs row for slug "${row.amcSlug}" (${row.reportMonth}) -- skipped.`);
      continue;
    }
    const calendarMonthEnd = lastDayOfReportMonth(row.reportMonth);
    const monthEndDate = await resolveMonthEndTradingDate(calendarMonthEnd);

    await db
      .insert(amcHistoricalAumAnchor)
      .values({ amcId: amc.id, reportMonth: row.reportMonth, monthEndDate, exitAumCr: String(row.exitAumCr) })
      .onConflictDoUpdate({
        target: [amcHistoricalAumAnchor.amcId, amcHistoricalAumAnchor.reportMonth],
        set: { monthEndDate, exitAumCr: String(row.exitAumCr) },
      });
    seeded++;
  }
  console.log(`Seeded ${seeded}/${anchors.length} monthly AUM anchor(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Historical AUM anchor seed failed:", err);
    process.exit(1);
  });
