// One-off seed for isin_daily_price: parses the user-provided "share
// price" pivot-table sheet (HDFC_and_7_AMC_Monthly_Equity_AUM.xlsx) into
// each of the 8 amc_listed_stock AMCs' own historical share price.
// Deliberately restricted to dates strictly before 2026-01-01 -- the
// sheet's export also includes 2026 dates, but that period is already
// tracked by the real daily DHAN-based pipeline (runAmcStockIngestion);
// this backfill must never touch or overwrite it. Writes into the SAME
// table every other equity price already lives in, keyed by each AMC's
// own ISIN from amc_listed_stock -- no new table needed for this half of
// the backfill. Coverage naturally varies per AMC (several of the 8 only
// listed well after 2023 -- see historical-backfill.ts's truncation logic,
// which handles this using whatever's actually written here).
// Safe to re-run -- upserts on (isin, snapshotDate).
import * as XLSX from "xlsx";
import { db } from "../src/lib/db/client";
import { amcs, amcListedStock } from "../src/lib/db/schema";
import { writeIsinDailyPriceRows } from "../src/lib/aum/isin-price-store";
import { eq } from "drizzle-orm";

const WORKBOOK_PATH = "/Users/siddhantkanodia/Documents/Claude Working Folder/AMC -Dashboard/HDFC_and_7_AMC_Monthly_Equity_AUM.xlsx";
const SHEET_NAME = "share price";
const HEADER_ROW_INDEX = 1; // 0-indexed; row 2 in Excel (row 0 is the pivot-table title row)
const CUTOFF_DATE = "2026-01-01"; // exclusive upper bound -- 2026+ stays on the real DHAN pipeline

// Pivot-table column header (legal entity name) -> amcSlug.
const COLUMN_TO_SLUG: Record<string, string> = {
  "Aditya Birla Sun Life AMC Ltd.": "aditya-birla-sun-life-mutual-fund",
  "Canara Robeco Asset Management Co Ltd.": "canara-robeco-mutual-fund",
  "HDFC Asset Management Company Ltd.": "hdfc-mutual-fund",
  "ICICI Prudential Asset Management Company Ltd.": "icici-prudential-mutual-fund",
  "Motilal Oswal Financial Services Ltd.": "motilal-oswal-mutual-fund",
  "Nippon Life India Asset Management Ltd.": "nippon-india-mutual-fund",
  "SBI Funds Management Ltd.": "sbi-mutual-fund",
  "UTI Asset Management Company Ltd.": "uti-mutual-fund",
};

function excelSerialToISO(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

interface PriceRow {
  amcSlug: string;
  date: string;
  priceInr: number;
}

function parseWorkbook(): PriceRow[] {
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

  const prices: PriceRow[] = [];
  for (let r = HEADER_ROW_INDEX + 1; r < rows.length; r++) {
    const row = rows[r];
    const dateSerial = row[0];
    if (typeof dateSerial !== "number") continue; // skips the "Grand Total" footer row (a string label)
    const date = excelSerialToISO(dateSerial);
    if (date >= CUTOFF_DATE) continue;
    for (const [colIndex, amcSlug] of colIndexToSlug) {
      const value = row[colIndex];
      if (typeof value !== "number") continue; // this AMC hadn't listed yet on this date
      prices.push({ amcSlug, date, priceInr: value });
    }
  }
  return prices;
}

async function main() {
  const prices = parseWorkbook();
  console.log(`Parsed ${prices.length} share-price row(s) from the workbook (dates < ${CUTOFF_DATE}).`);

  const listedStocks = await db
    .select({ isin: amcListedStock.isin, slug: amcs.slug })
    .from(amcListedStock)
    .innerJoin(amcs, eq(amcListedStock.amcId, amcs.id));
  const isinBySlug = new Map(listedStocks.map((r) => [r.slug, r.isin]));

  const byIsin = new Map<string, { isin: string; snapshotDate: string; priceInr: number }[]>();
  let skipped = 0;
  for (const row of prices) {
    const isin = isinBySlug.get(row.amcSlug);
    if (!isin) {
      console.error(`No amc_listed_stock row for slug "${row.amcSlug}" -- skipped.`);
      skipped++;
      continue;
    }
    const list = byIsin.get(isin) ?? [];
    list.push({ isin, snapshotDate: row.date, priceInr: row.priceInr });
    byIsin.set(isin, list);
  }

  let written = 0;
  for (const [isin, rows] of byIsin) {
    await writeIsinDailyPriceRows(rows);
    written += rows.length;
    const dates = rows.map((r) => r.snapshotDate).sort();
    console.log(`${isin}: wrote ${rows.length} price row(s), range ${dates[0]} .. ${dates[dates.length - 1]}`);
  }
  console.log(`Done. ${written} row(s) written, ${skipped} skipped.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Historical AMC share price seed failed:", err);
    process.exit(1);
  });
