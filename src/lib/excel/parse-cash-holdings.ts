import type { WorkBook } from "xlsx";
import { utils } from "xlsx";

// Shared by importWorkbook() (automatic, folded into the monthly upload) and
// scripts/import-cash-holdings-history.ts (manual recovery/backfill) so the
// two paths can never drift. Parses the workbook's "Cash Holdings" sheet,
// column K block (the genuine one-row-per-AMC "CCE % of AUM - AMC wise"
// table -- distinct from the scheme-specific breakdowns further right in the
// same sheet). The sheet embeds a rolling 6-month window (e.g. Feb-26..Jul-26
// in July's file), so a single parse yields up to 6 months at once.
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

function parseMonthLabel(label: string): string | null {
  const [abbr, yy] = label.trim().split("-");
  const mm = MONTH_ABBR[abbr?.toLowerCase()];
  if (!mm || !yy) return null;
  return `20${yy}-${mm}`;
}

export interface ParsedCashHoldingRow {
  sheetName: string;
  month: string;
  ccePct: number;
}

export interface ParsedCashHoldings {
  rows: ParsedCashHoldingRow[];
  warnings: string[];
}

/**
 * Unlike the standalone script (which throws on a shifted layout, since a
 * human is watching the output), this never throws -- a Cash Holdings sheet
 * problem in some future month must never abort the whole monthly import,
 * only skip this cross-check with a visible warning, matching how
 * importWorkbook() already treats other per-AMC anomalies.
 */
export function parseCashHoldingsSheet(wb: WorkBook): ParsedCashHoldings {
  const sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) {
    return { rows: [], warnings: [`[Cash Holdings] Sheet not found in workbook — official CCE% history was not updated.`] };
  }

  const rows: unknown[][] = utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const warnings: string[] = [];

  const headerRow = rows[HEADER_ROW];
  const months: string[] = [];
  for (let col = MONTH_COLS_START; col <= MONTH_COLS_END; col++) {
    const label = headerRow?.[col];
    if (typeof label !== "string") {
      warnings.push(
        `[Cash Holdings] Expected a month label at row ${HEADER_ROW + 1}, col ${col + 1} — got ${JSON.stringify(label)}. Sheet layout may have shifted; official CCE% history was not updated.`
      );
      return { rows: [], warnings };
    }
    const month = parseMonthLabel(label);
    if (!month) {
      warnings.push(`[Cash Holdings] Unrecognized month label "${label}" at col ${col + 1} — official CCE% history was not updated.`);
      return { rows: [], warnings };
    }
    months.push(month);
  }

  // Data end row is detected dynamically -- not a fixed row count, since the
  // AMC list grows over time (June's sheet outgrew a previous hardcoded
  // range). Scans to the last row with a name in NAME_COL, then iterates
  // that full span -- tolerates a blank spacer row *within* the block
  // (skipped via `continue` below, not treated as the end).
  let dataEndRow = DATA_START_ROW - 1;
  for (let r = DATA_START_ROW; r < rows.length; r++) {
    const v = rows[r]?.[NAME_COL];
    if (v !== null && v !== undefined && String(v).trim() !== "") dataEndRow = r;
  }

  const parsedRows: ParsedCashHoldingRow[] = [];
  for (let r = DATA_START_ROW; r <= dataEndRow; r++) {
    const rawName = rows[r]?.[NAME_COL];
    if (rawName === null || rawName === undefined || String(rawName).trim() === "") continue;
    const sheetName = String(rawName).trim();

    for (let i = 0; i < months.length; i++) {
      const rawPct = rows[r]?.[MONTH_COLS_START + i];
      if (typeof rawPct !== "number") continue;
      parsedRows.push({ sheetName, month: months[i], ccePct: rawPct });
    }
  }

  return { rows: parsedRows, warnings };
}
