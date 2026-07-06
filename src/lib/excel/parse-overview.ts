import type { WorkBook } from "xlsx";
import { utils } from "xlsx";
import { assertHeaderRowAt } from "./find-header-row";
import type { OverviewRow } from "./types";

const HEADER_ROW_INDEX = 5; // row 6 (1-based)
const DATA_START_INDEX = 6; // row 7 (1-based)
// Ceiling, not an exact target: the industry has only ever grown, so a
// historical workbook (an older month) legitimately has FEWER AMC rows than
// today's -- funds launch, they don't retroactively un-launch. A count above
// this constant means either a genuinely new AMC (bump this + add it to
// data/amc-name-map.json) or a parsing bug reading into unrelated rows.
const MAX_AMC_COUNT = 56;

const COL = {
  fundHouseName: 1,
  reportedAumCr: 2,
  prevReportedAumCr: 3,
  changeMomPct: 4,
  changeCr: 5,
} as const;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value == null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseOverviewSheet(wb: WorkBook): OverviewRow[] {
  const ws = wb.Sheets["Overview"];
  if (!ws) throw new Error("[Overview] Sheet not found in workbook");

  const rows = utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });

  assertHeaderRowAt(
    rows,
    ["Fund House Name", "S. No."],
    HEADER_ROW_INDEX,
    10,
    "Overview"
  );

  const result: OverviewRow[] = [];
  for (let i = DATA_START_INDEX; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const overviewName = row[COL.fundHouseName];
    if (overviewName == null || String(overviewName).trim() === "") break;

    result.push({
      overviewName: String(overviewName).trim(),
      reportedAumCr: toNumber(row[COL.reportedAumCr]),
      prevReportedAumCr: toNumber(row[COL.prevReportedAumCr]),
      changeMomPct: toNullableNumber(row[COL.changeMomPct]) ?? 0,
      changeCr: toNumber(row[COL.changeCr]),
    });
  }

  if (result.length === 0 || result.length > MAX_AMC_COUNT) {
    throw new Error(
      `[Overview] Parsed ${result.length} AMC rows, expected somewhere between 1 and ${MAX_AMC_COUNT}. ` +
        `The workbook's AMC list may have grown beyond MAX_AMC_COUNT, or this is a parsing bug -- ` +
        `update MAX_AMC_COUNT and data/amc-name-map.json if a genuinely new AMC was added.`
    );
  }

  return result;
}

const MONTH_ABBREVIATIONS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/**
 * Derives the report period (e.g. "2026-05") from the Overview header text
 * ("May-26 AUM"), rather than trusting the uploaded filename.
 */
export function deriveReportPeriod(wb: WorkBook): string {
  const ws = wb.Sheets["Overview"];
  if (!ws) throw new Error("[Overview] Sheet not found in workbook");

  const rows = utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
  const headerRow = rows[HEADER_ROW_INDEX] ?? [];
  const headerText = String(headerRow[COL.reportedAumCr] ?? "");

  const match = headerText.match(/([A-Za-z]{3})-(\d{2})/);
  if (!match) {
    throw new Error(
      `[Overview] Could not derive report period from header text "${headerText}" (expected e.g. "May-26 AUM")`
    );
  }

  const monthAbbr = match[1].toLowerCase();
  const month = MONTH_ABBREVIATIONS[monthAbbr];
  if (!month) {
    throw new Error(`[Overview] Unrecognized month abbreviation "${match[1]}" in header text "${headerText}"`);
  }

  const year = `20${match[2]}`;
  return `${year}-${month}`;
}
