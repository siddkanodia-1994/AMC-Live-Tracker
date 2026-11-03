import { read, type WorkBook } from "xlsx";
import { assertMapCoversWorkbook, getAmcMap } from "./amc-name-map";
import { deriveReportPeriod, parseOverviewSheet } from "./parse-overview";
import { parseAmcSheet } from "./parse-amc-sheet";
import { parseCashHoldingsSheet, type ParsedCashHoldings } from "./parse-cash-holdings";
import type { AmcNameMapEntry, OverviewRow, ParsedAmcSheet } from "./types";

// Deliberately imports nothing from lib/db: importWorkbook() consumes this,
// and so does the zero-write dry run (scripts/import-excel.ts --dry-run),
// which must never load the transactional client at all.

export interface ParsedAmc {
  entry: AmcNameMapEntry;
  overviewRow: OverviewRow;
  sheet: ParsedAmcSheet;
  residualPlugCr: number;
}

export interface ParsedWorkbook {
  reportPeriod: string;
  overviewRows: OverviewRow[];
  // In amc-name-map order, only the AMCs present in this workbook's Overview.
  amcs: ParsedAmc[];
  cashHoldings: ParsedCashHoldings;
  // Every warning that can be known from the file alone, in the same order
  // importWorkbook() has always reported them. DB-dependent warnings (Cash
  // Holdings rows with no matching AMC, the backward-period pointer) are
  // appended by importWorkbook() itself.
  warnings: string[];
}

/**
 * Everything importWorkbook() needs, with no DB access -- so a dry run (see
 * scripts/import-excel.ts --dry-run) can validate a new file without ever
 * touching the transactional client. Throws on the same hard failures the
 * import always has (unmapped Overview names, missing sheets, a shifted
 * header row).
 */
export function parseWorkbook(fileBuffer: Buffer): ParsedWorkbook {
  const wb: WorkBook = read(fileBuffer, { type: "buffer", cellDates: false });

  const overviewRows = parseOverviewSheet(wb);
  const reportPeriod = deriveReportPeriod(wb);
  assertMapCoversWorkbook(wb, overviewRows);

  const overviewByName = new Map(overviewRows.map((r) => [r.overviewName, r]));
  const warnings: string[] = [];
  const cashHoldings = parseCashHoldingsSheet(wb);
  warnings.push(...cashHoldings.warnings);

  const parsedAmcs: ParsedAmc[] = [];
  for (const entry of getAmcMap()) {
    const overviewRow = overviewByName.get(entry.overviewName);
    if (!overviewRow) {
      // A mapped AMC with no Overview row in THIS workbook -- expected for
      // a historical (older) import, since a fund that launched later
      // simply didn't exist yet in an earlier month. assertMapCoversWorkbook
      // already guarantees the reverse (every row IN the workbook has a map
      // entry), so this is a legitimate skip, not a data-integrity problem.
      warnings.push(`[${entry.overviewName}] Not present in this workbook -- skipped (likely didn't exist yet as of this period).`);
      continue;
    }

    const parsedSheet = parseAmcSheet(wb, entry.sheetName);
    for (const w of parsedSheet.warnings) {
      warnings.push(`[${entry.overviewName}] ${w}`);
    }

    if (
      parsedSheet.equityAumHeaderCr != null &&
      Math.abs(parsedSheet.equityAumHeaderCr - overviewRow.reportedAumCr) > 1
    ) {
      warnings.push(
        `[${entry.overviewName}] Sheet's equity-AUM header (${parsedSheet.equityAumHeaderCr}) disagrees with Overview's reported AUM (${overviewRow.reportedAumCr}) by more than 1 cr.`
      );
    }

    parsedAmcs.push({
      entry,
      overviewRow,
      sheet: parsedSheet,
      residualPlugCr: overviewRow.reportedAumCr - parsedSheet.sheetTotalHoldingsValueCr,
    });
  }

  return { reportPeriod, overviewRows, amcs: parsedAmcs, cashHoldings, warnings };
}
