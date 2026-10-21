import type { Workbook, Worksheet } from "exceljs";
import type { DetailedExportAmcGroup, DetailedExportSchemeBlock } from "./detailed-export";

const AUM_FORMAT = "#,##0.00";
const NAV_FORMAT = "0.0000";
const FLOW_FORMAT = "+#,##0.00;-#,##0.00;0.00";
const PCT_FORMAT = "+0.0000%;-0.0000%;0.0000%";
const FACTOR_FORMAT = "0.000000";
const ANCHOR_FILL = "FFFFF2CC"; // light amber -- marks a segment's own latest (top) row, where Price-only AUM's roll-forward resets

// Column offsets within one scheme block (0-indexed). The first 7 are the
// original, directly-requested columns in their original order; the rest
// are the helper columns that make Price-only AUM / Daily Flow / Daily AUM
// genuine live formulas instead of hard numbers.
const COL = {
  DATE: 0,
  QUARTER: 1,
  AUM: 2,
  NAV: 3,
  PRICE: 4,
  FLOW: 5,
  QAVG: 6,
  ASTART: 7,
  AEND: 8,
  AANCHOR: 9,
  RET: 10,
  FWD: 11,
} as const;
const BLOCK_WIDTH = 12;

const HEADERS: Record<keyof typeof COL, string> = {
  DATE: "Date",
  QUARTER: "Quarter",
  AUM: "Daily AUM (Cr)",
  NAV: "Daily NAV",
  PRICE: "Price-only AUM (Cr)",
  FLOW: "Daily Flow (Cr)",
  QAVG: "Quarter Avg AUM (Cr)",
  ASTART: "Anchor Start Date",
  AEND: "Anchor End Date",
  AANCHOR: "Anchor AUM (Cr)",
  RET: "NAV Daily Return %",
  FWD: "Fwd Compounding Factor",
};

// Converts a 0-indexed column number to its Excel letter(s) -- A, B, ..., Z, AA, AB, ...
function colLetter(index0: number): string {
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function writeSchemeBlock(ws: Worksheet, startCol: number, block: DetailedExportSchemeBlock | null, fallbackLabel: string): void {
  const titleCell = ws.getCell(1, startCol + 1);
  titleCell.value = block ? `${block.schemeName} (${block.assetClass === "gold" ? "Gold" : "Silver"})` : `${fallbackLabel} -- no scheme`;
  titleCell.font = { bold: true };
  ws.mergeCells(1, startCol + 1, 1, startCol + BLOCK_WIDTH);

  (Object.keys(COL) as (keyof typeof COL)[]).forEach((key) => {
    const cell = ws.getCell(2, startCol + 1 + COL[key]);
    cell.value = HEADERS[key];
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: "right", wrapText: true };
  });

  if (!block || block.rows.length === 0) return;

  const n = block.rows.length;
  const firstRow = 3;
  const lastRow = firstRow + n - 1;

  // Absolute column letters for this block, 1-indexed spreadsheet columns.
  const L = (key: keyof typeof COL) => colLetter(startCol + COL[key]);
  const rng = (key: keyof typeof COL) => `$${L(key)}$${firstRow}:$${L(key)}$${lastRow}`;

  block.rows.forEach((r, i) => {
    const row = firstRow + i;
    const isTop = row === firstRow; // latest date in the WHOLE sheet
    const isBottom = row === lastRow; // earliest date in the WHOLE sheet -- the scheme's true origin, nothing to roll forward from

    ws.getCell(row, startCol + 1 + COL.DATE).value = r.date;
    ws.getCell(row, startCol + 1 + COL.QUARTER).value = r.quarterLabel;
    ws.getCell(row, startCol + 1 + COL.ASTART).value = r.anchorStartDate;
    ws.getCell(row, startCol + 1 + COL.AEND).value = r.anchorEndDate;

    const anchorCell = ws.getCell(row, startCol + 1 + COL.AANCHOR);
    anchorCell.value = r.anchorAumCr;
    anchorCell.numFmt = AUM_FORMAT;

    const navCell = ws.getCell(row, startCol + 1 + COL.NAV);
    if (r.dailyNav != null) {
      navCell.value = r.dailyNav;
      navCell.numFmt = NAV_FORMAT;
    } else {
      navCell.value = "—";
    }

    // NAV Daily Return % -- blank for the very last (earliest) row, which
    // has no prior day of its own within this scheme's history to compare against.
    const retCell = ws.getCell(row, startCol + 1 + COL.RET);
    if (!isBottom) {
      retCell.value = { formula: `IFERROR(${L("NAV")}${row}/${L("NAV")}${row + 1}-1,"")`, result: r.navReturnPct ?? undefined };
      retCell.numFmt = PCT_FORMAT;
    } else {
      retCell.value = "";
    }

    // Forward-compounding factor: 1.0 at a segment's own top (latest) row,
    // else built backward from the row above (which belongs to a LATER
    // day, already computed, since the sheet is sorted latest-first).
    const fwdCell = ws.getCell(row, startCol + 1 + COL.FWD);
    if (isTop) {
      fwdCell.value = r.forwardFactor; // = 1 for the very first row (always its own segment's top)
    } else {
      fwdCell.value = {
        formula: `IF(${L("AEND")}${row}<>${L("AEND")}${row - 1},1,${L("FWD")}${row - 1}*(1+${L("RET")}${row - 1}))`,
        result: r.forwardFactor,
      };
    }
    fwdCell.numFmt = FACTOR_FORMAT;

    // Price-only AUM: pure NAV roll-forward, resetting to the PRIOR
    // segment's final Daily AUM (= that segment's own real anchor value)
    // whenever this row starts a new segment -- shaded to flag that reset.
    const priceCell = ws.getCell(row, startCol + 1 + COL.PRICE);
    const isSegmentTop = i === 0 || r.anchorEndDate !== block.rows[i - 1].anchorEndDate;
    if (isBottom) {
      priceCell.value = r.priceOnlyAumCr; // true origin -- nothing earlier in this scheme's history to roll forward from
    } else {
      priceCell.value = {
        formula: `IF(${L("AEND")}${row}<>${L("AEND")}${row + 1},${L("AUM")}${row + 1},${L("PRICE")}${row + 1})*(1+${L("RET")}${row})`,
        result: r.priceOnlyAumCr,
      };
    }
    priceCell.numFmt = AUM_FORMAT;
    if (isSegmentTop) priceCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ANCHOR_FILL } };

    // Daily Flow: the Modified-Dietz solve, reconstructed via SUMIFS over
    // this row's own segment (keyed by Anchor End Date) -- works uniformly
    // for every row, including the live (open-quarter) tail, where each
    // day "closes" its own 1-row segment and the formula naturally solves
    // to 0 (anchorAumCr == priceOnlyAumCr there by construction).
    const flowCell = ws.getCell(row, startCol + 1 + COL.FLOW);
    flowCell.value = {
      formula: `(${L("AANCHOR")}${row}-SUMIFS(${rng("PRICE")},${rng("AEND")},${L("AEND")}${row},${rng("DATE")},${L("AEND")}${row}))/SUMIFS(${rng("FWD")},${rng("AEND")},${L("AEND")}${row})`,
      result: r.dailyFlowCr,
    };
    flowCell.numFmt = FLOW_FORMAT;

    // Daily AUM: the final, flow-inclusive series -- continuous across
    // segment boundaries (no reset needed; the prior segment's own final
    // value already equals its real anchor by construction).
    const aumCell = ws.getCell(row, startCol + 1 + COL.AUM);
    if (isBottom) {
      aumCell.value = r.dailyAumCr; // true origin
    } else {
      aumCell.value = { formula: `${L("AUM")}${row + 1}*(1+${L("RET")}${row})+${L("FLOW")}${row}`, result: r.dailyAumCr };
    }
    aumCell.numFmt = AUM_FORMAT;

    // Quarter Avg AUM: plain average of this quarter's own Daily AUM rows,
    // wherever they fall in the sheet.
    const qavgCell = ws.getCell(row, startCol + 1 + COL.QAVG);
    qavgCell.value = { formula: `AVERAGEIF(${rng("QUARTER")},${L("QUARTER")}${row},${rng("AUM")})`, result: r.quarterAvgAumCr };
    qavgCell.numFmt = AUM_FORMAT;
  });
}

/**
 * One AMC's sheet: Gold's 12-column block, a blank spacer column, then
 * Silver's 12-column block -- both always present if the AMC has the
 * scheme, regardless of which ranking (top-5 Gold / top-5 Silver) is what
 * actually pulled this AMC into the export. Price-only AUM, Daily Flow,
 * and Daily AUM are live formulas (see writeSchemeBlock), not hard
 * numbers -- each cell also carries its already-verified computed value
 * as exceljs's cached `result`, so what's displayed on open is correct
 * immediately, before any recalculation.
 */
export function buildEtfDetailedExcelSheet(workbook: Workbook, group: DetailedExportAmcGroup): void {
  const ws = workbook.addWorksheet(group.overviewName.slice(0, 31));
  const goldStart = 0;
  const silverStart = goldStart + BLOCK_WIDTH + 1;
  ws.columns = [
    ...Array(BLOCK_WIDTH).fill(null).map(() => ({ width: 13 })),
    { width: 3 },
    ...Array(BLOCK_WIDTH).fill(null).map(() => ({ width: 13 })),
  ];
  writeSchemeBlock(ws, goldStart, group.gold, "Gold ETF");
  writeSchemeBlock(ws, silverStart, group.silver, "Silver ETF");
}
