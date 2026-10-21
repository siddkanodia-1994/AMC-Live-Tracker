import type { Workbook, Worksheet } from "exceljs";
import type { DetailedExportAmcGroup, DetailedExportSchemeBlock } from "./detailed-export";

const AUM_FORMAT = "#,##0.00";
const NAV_FORMAT = "0.0000";
const FLOW_FORMAT = "+#,##0.00;-#,##0.00;0.00";

const HEADERS = ["Date", "Quarter", "Daily AUM (Cr)", "Daily NAV", "Price-only AUM (Cr)", "Daily Flow (Cr)", "Quarter Avg AUM (Cr)"];
const BLOCK_WIDTH = HEADERS.length; // 7 columns per scheme block, one blank spacer column between blocks

function writeSchemeBlock(ws: Worksheet, startCol: number, block: DetailedExportSchemeBlock | null, fallbackLabel: string): void {
  const titleCell = ws.getCell(1, startCol);
  titleCell.value = block ? `${block.schemeName} (${block.assetClass === "gold" ? "Gold" : "Silver"})` : `${fallbackLabel} -- no scheme`;
  titleCell.font = { bold: true };
  ws.mergeCells(1, startCol, 1, startCol + BLOCK_WIDTH - 1);

  HEADERS.forEach((h, i) => {
    const cell = ws.getCell(2, startCol + i);
    cell.value = h;
    cell.font = { bold: true, size: 9 };
    cell.alignment = { horizontal: "right" };
  });

  if (!block) return;

  block.rows.forEach((r, rowIdx) => {
    const row = rowIdx + 3;
    ws.getCell(row, startCol).value = r.date;
    ws.getCell(row, startCol + 1).value = r.quarterLabel;
    const aumCell = ws.getCell(row, startCol + 2);
    aumCell.value = r.dailyAumCr;
    aumCell.numFmt = AUM_FORMAT;
    const navCell = ws.getCell(row, startCol + 3);
    if (r.dailyNav != null) {
      navCell.value = r.dailyNav;
      navCell.numFmt = NAV_FORMAT;
    } else {
      navCell.value = "—";
    }
    const priceCell = ws.getCell(row, startCol + 4);
    priceCell.value = r.priceOnlyAumCr;
    priceCell.numFmt = AUM_FORMAT;
    const flowCell = ws.getCell(row, startCol + 5);
    flowCell.value = r.dailyFlowCr;
    flowCell.numFmt = FLOW_FORMAT;
    const avgCell = ws.getCell(row, startCol + 6);
    avgCell.value = r.quarterAvgAumCr;
    avgCell.numFmt = AUM_FORMAT;
  });
}

/**
 * One AMC's sheet: Gold's 7-column block, a blank spacer column, then
 * Silver's 7-column block -- both always present if the AMC has the
 * scheme, regardless of which ranking (top-5 Gold / top-5 Silver) is what
 * actually pulled this AMC into the export.
 */
export function buildEtfDetailedExcelSheet(workbook: Workbook, group: DetailedExportAmcGroup): void {
  const ws = workbook.addWorksheet(group.overviewName.slice(0, 31));
  const goldStart = 1;
  const silverStart = goldStart + BLOCK_WIDTH + 1;
  ws.columns = [
    ...Array(BLOCK_WIDTH).fill({ width: 14 }),
    { width: 3 },
    ...Array(BLOCK_WIDTH).fill({ width: 14 }),
  ];
  writeSchemeBlock(ws, goldStart, group.gold, "Gold ETF");
  writeSchemeBlock(ws, silverStart, group.silver, "Silver ETF");
}
