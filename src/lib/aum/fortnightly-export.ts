import type { Workbook, Worksheet } from "exceljs";
import { formatPct, formatPriceInr, formatShortDate } from "../utils/format";
import type { FortnightlySheet, ScenarioValues } from "./fortnightly-update";

// Shared intermediate representation consumed by both the Excel (xlsx) and
// PDF (jsPDF/autotable) exporters, so the two can never drift out of sync
// with each other over what a "Fortnightly AMC Update" export actually
// contains -- each section becomes one worksheet block / one autoTable.
export interface ExportSection {
  title: string;
  rows: string[][]; // first row is the header row
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatPct(v, { alwaysSign: true }));
// Whole crores, no decimals -- matches the tab's own formatCrRounded, not
// the shared formatCr() (2 decimals) used elsewhere in the app, so the
// export stays numerically consistent with what the UI itself now shows.
//
// "Rs." instead of "₹": this function's output feeds ONLY the PDF export
// (buildFortnightlySheetExcel has its own separate, ₹-safe formatting for
// Excel) -- jsPDF's built-in Helvetica font has no ₹ glyph and silently
// substitutes a stray mark in its place (confirmed by rendering a sample
// PDF), so this file uses the plain-ASCII form specifically for the PDF
// path rather than carrying that rendering bug into the "same colour
// format" fix. The live UI and the Excel export both still show the real
// ₹ symbol, since neither has this font limitation.
const cr = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `Rs.${Math.round(v).toLocaleString("en-IN")} cr`);
const crAmount = (v: number | null) => (v === null ? "—" : Math.round(v).toLocaleString("en-IN"));
const price = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `Rs.${formatPriceInr(v).slice(1)}`);
const scenarioRow = (label: string, values: ScenarioValues, fmt: (v: number | null) => string): string[] => [
  label,
  fmt(values.bear),
  fmt(values.base),
  fmt(values.bull),
];

// Mirrors fortnightly-update-panel.tsx's SipAmcGrowthTable/
// SipIndustryGrowthTable qoqByRow+yoyByRow (and momByRow+yoyByRow)
// derivation: of the 5 period rows (latest, prevA, prevB, yoyA, yoyB),
// only latest-vs-prevA and prevA-vs-prevB have a "one period back" row
// to divide against; the YoY pair mirrors the same two rows, three
// positions further down. Kept here (not imported from that component)
// so this file's export math stays pure/testable without a React import.
function periodRatios(vals: (number | null)[]): { stepByRow: (number | null)[]; yoyByRow: (number | null)[] } {
  const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b !== 0 ? a / b - 1 : null);
  return {
    stepByRow: [ratio(vals[0], vals[1]), ratio(vals[1], vals[2]), null, null, null],
    yoyByRow: [ratio(vals[0], vals[3]), ratio(vals[1], vals[4]), null, null, null],
  };
}

export function buildFortnightlyExportSections(sheet: FortnightlySheet): ExportSection[] {
  const m = sheet.manual;
  const v = sheet.valuation;

  const header: ExportSection = {
    title: `${sheet.overviewName} — as of ${formatShortDate(sheet.asOfDate)}`,
    rows: [
      ["Stock", sheet.overviewName],
      ["CMP", price(sheet.cmpInr)],
      ["No of Shares (Cr)", m.noOfSharesCr === null ? "—" : String(m.noOfSharesCr)],
    ],
  };

  const pat: ExportSection = {
    title: "PAT",
    rows: [
      ["Period", "FY26A", "FY27E", "FY28E", "2Y CAGR"],
      [
        "PAT (Cr)",
        crAmount(m.patFy26aCr),
        crAmount(m.patFy27eCr),
        crAmount(m.patFy28eCr),
        pct(v.cagr2yPct),
      ],
    ],
  };

  const valuation: ExportSection = {
    title: "Valuation (Bear / Base / Bull)",
    rows: [
      ["", "Bear", "Base", "Bull"],
      scenarioRow("Target PE", { bear: m.targetPeBear, base: m.targetPeBase, bull: m.targetPeBull }, (x) => (x === null ? "—" : String(x))),
      scenarioRow("FY28 Target Market Cap (Cr)", v.fy28TargetMcapCr, cr),
      scenarioRow("FY28 Target Price", v.fy28TargetPriceInr, price),
      scenarioRow("FY28 Upside %", v.fy28UpsidePct, pct),
      scenarioRow("FY27 Discounted Price", v.fy27DiscountedPriceInr, price),
      scenarioRow("FY27 Upside %", v.fy27UpsidePct, pct),
      scenarioRow("FY26 Discounted Price", v.fy26DiscountedPriceInr, price),
      scenarioRow("FY26 Upside %", v.fy26UpsidePct, pct),
    ],
  };

  const qaaum: ExportSection = {
    title: "Quarterly Averages — QAAUM",
    rows: [
      ["Period", "Val (Cr)", "QoQ", "YoY"],
      ...sheet.qaaum.map((r) => [r.label, cr(r.valCr), pct(r.qoqPct ?? null), pct(r.yoyPct ?? null)]),
    ],
  };

  const sipAmcRows: [string, number | null, number | null][] = [
    [`Latest Available Quarter (${sheet.sipAmcLabels.qtd})`, m.sipAmcQtdValCr, m.sipAmcQtdPct],
    [`Previous Quarter (${sheet.sipAmcLabels.prevQ})`, m.sipAmcPrevQValCr, m.sipAmcPrevQPct],
    [`Previous Quarter (${sheet.sipAmcLabels.prevQ2})`, m.sipAmcPrevQ2ValCr, m.sipAmcPrevQ2Pct],
    [`Last Year Same Quarter (${sheet.sipAmcLabels.yoyQ})`, m.sipAmcYoyQValCr, m.sipAmcYoyQPct],
    [`Last Year Same Quarter (${sheet.sipAmcLabels.yoyQ2})`, m.sipAmcYoyQ2ValCr, m.sipAmcYoyQ2Pct],
  ];
  const sipAmcRatios = periodRatios(sipAmcRows.map(([, val]) => val));
  const sipAmc: ExportSection = {
    title: "SIP AMC Growth",
    rows: [
      ["Period", "Val (Cr)", "QoQ", "YoY", "SIP/Equity AUM"],
      ...sipAmcRows.map(([label, val, p], i) => [
        label,
        cr(val),
        pct(sipAmcRatios.stepByRow[i]),
        pct(sipAmcRatios.yoyByRow[i]),
        p === null ? "—" : pct(p),
      ]),
    ],
  };

  const industryAuto = sheet.sipIndustryAuto;
  const withPeriod = (base: string, period: string | undefined) => (period ? `${base} (${period})` : base);
  const sipIndustryRows: [string, number | null][] = [
    [withPeriod("Latest Available Month", industryAuto?.labels.qtd), m.sipIndustryMtdValCr ?? industryAuto?.values.mtd ?? null],
    [withPeriod("Previous Month", industryAuto?.labels.prevQ), m.sipIndustryPrevMValCr ?? industryAuto?.values.prevM ?? null],
    [withPeriod("Previous Month", industryAuto?.labels.prevQ2), m.sipIndustryPrevM2ValCr ?? industryAuto?.values.prevM2 ?? null],
    [withPeriod("Last Year Month", industryAuto?.labels.yoyQ), m.sipIndustryYoyMValCr ?? industryAuto?.values.yoyM ?? null],
    [withPeriod("Last Year Month", industryAuto?.labels.yoyQ2), m.sipIndustryYoyM2ValCr ?? industryAuto?.values.yoyM2 ?? null],
  ];
  const sipIndustryRatios = periodRatios(sipIndustryRows.map(([, val]) => val));
  const sipIndustry: ExportSection = {
    title: "SIP Industry Growth",
    rows: [
      ["Period", "Val (Cr)", "MoM", "YoY"],
      ...sipIndustryRows.map(([label, val], i) => [label, cr(val), pct(sipIndustryRatios.stepByRow[i]), pct(sipIndustryRatios.yoyByRow[i])]),
    ],
  };

  const ratio: ExportSection = {
    title: "Ratio (Price / Avg AUM)",
    rows: [
      ["SD Level", sheet.ratio?.sdLevel === null || sheet.ratio?.sdLevel === undefined ? "—" : sheet.ratio.sdLevel.toFixed(2)],
      ["Upside to Mean", pct(sheet.ratio?.upsideToMeanPct ?? null)],
      ["Time Period", sheet.ratio?.timePeriodLabel ?? "—"],
      ["Avg AUM Days", sheet.ratio ? `${sheet.ratio.avgAumDays} Days` : "—"],
      ["Correlation", pct(sheet.ratio?.correlationPct ?? null)],
      ["R-Square", pct(sheet.ratio?.rSquared ?? null)],
    ],
  };

  return [header, pat, valuation, qaaum, sipAmc, sipIndustry, ratio];
}

// ---------------------------------------------------------------------
// Excel export -- ExcelJS (not this app's usual xlsx/SheetJS), same reason
// as summary-panel.tsx's own buildSummaryWorksheet: SheetJS's free build
// silently drops cell fill/font styling on write, while ExcelJS writes
// real colors. Same banner/percentage colors as that file (and as this
// tab's own on-screen PctCell/SectionBanner), plus a light-blue fill
// (matching the dashboard's own input-cell shade) on every cell that's a
// manually-editable field on the live sheet, so the export visually marks
// "this was typed in" vs. "this was computed" the same way the tab does.
// ---------------------------------------------------------------------

const CR_FORMAT = '"₹"#,##0" cr"'; // whole crores, no decimals -- matches the tab's own formatCrRounded
const PLAIN_FORMAT = "#,##0";
const PRICE_FORMAT = '"₹"#,##0.00';
const PCT_FORMAT = "+0.00%;-0.00%";

const POS_FILL = "FFC6EFCE";
const POS_FONT = "FF006100";
const NEG_FILL = "FFFFC7CE";
const NEG_FONT = "FF9C0006";
const BANNER_FILL = "FF000000";
const BANNER_FONT = "FFFFFFFF";
const INPUT_FILL = "FFD7ECFF"; // the dashboard's own input-cell shade

function writeBanner(ws: Worksheet, row: number, text: string, span: number): void {
  ws.mergeCells(row, 1, row, span);
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = { bold: true, color: { argb: BANNER_FONT } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BANNER_FILL } };
}

function writeHeaderRow(ws: Worksheet, row: number, cells: string[]): void {
  cells.forEach((text, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = text;
    cell.font = { bold: true, size: 9 };
    if (i > 0) cell.alignment = { horizontal: "right" };
  });
}

function writeLabel(ws: Worksheet, row: number, col: number, text: string): void {
  ws.getCell(row, col).value = text;
}

function writeNum(ws: Worksheet, row: number, col: number, value: number | null, numFmt: string, input = false): void {
  const cell = ws.getCell(row, col);
  if (value === null) {
    cell.value = "—";
    cell.alignment = { horizontal: "right" };
    return;
  }
  cell.value = value;
  cell.numFmt = numFmt;
  cell.alignment = { horizontal: "right" };
  if (input) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_FILL } };
}

function writePct(ws: Worksheet, row: number, col: number, value: number | null | undefined): void {
  const cell = ws.getCell(row, col);
  if (value === null || value === undefined) {
    cell.value = "—";
    cell.alignment = { horizontal: "right" };
    return;
  }
  cell.value = value;
  cell.numFmt = PCT_FORMAT;
  cell.alignment = { horizontal: "right" };
  const positive = value >= 0;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: positive ? POS_FILL : NEG_FILL } };
  cell.font = { bold: true, color: { argb: positive ? POS_FONT : NEG_FONT } };
}

function writeScenarioRow(
  ws: Worksheet,
  row: number,
  label: string,
  values: ScenarioValues,
  write: (col: number, value: number | null) => void
): void {
  writeLabel(ws, row, 1, label);
  write(2, values.bear);
  write(3, values.base);
  write(4, values.bull);
}

/** One AMC's full Fortnightly sheet, written directly into a new worksheet -- layout and colors mirror the live tab exactly (see the helpers above). */
export function buildFortnightlySheetExcel(workbook: Workbook, sheet: FortnightlySheet): void {
  const ws = workbook.addWorksheet(sheet.overviewName.slice(0, 31));
  ws.columns = [{ width: 32 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];
  const m = sheet.manual;
  const v = sheet.valuation;
  let row = 1;

  writeBanner(ws, row, "Stock", 5);
  row++;
  writeLabel(ws, row, 1, "Stock");
  writeLabel(ws, row, 2, sheet.overviewName);
  row++;
  writeLabel(ws, row, 1, "CMP");
  writeNum(ws, row, 2, sheet.cmpInr, PRICE_FORMAT);
  row++;
  writeLabel(ws, row, 1, "No of Shares (Cr)");
  writeNum(ws, row, 2, m.noOfSharesCr, PLAIN_FORMAT + ".0", true);
  row += 2;

  writeBanner(ws, row, "PAT", 5);
  row++;
  writeHeaderRow(ws, row, ["Period", "FY26A", "FY27E", "FY28E", "2Y CAGR"]);
  row++;
  writeLabel(ws, row, 1, "PAT (Cr)");
  writeNum(ws, row, 2, m.patFy26aCr, PLAIN_FORMAT, true);
  writeNum(ws, row, 3, m.patFy27eCr, PLAIN_FORMAT, true);
  writeNum(ws, row, 4, m.patFy28eCr, PLAIN_FORMAT, true);
  writePct(ws, row, 5, v.cagr2yPct);
  row += 2;

  writeBanner(ws, row, "Valuation (Bear / Base / Bull)", 4);
  row++;
  writeHeaderRow(ws, row, ["", "Bear", "Base", "Bull"]);
  row++;
  writeScenarioRow(ws, row, "Target PE", { bear: m.targetPeBear, base: m.targetPeBase, bull: m.targetPeBull }, (col, val) =>
    writeNum(ws, row, col, val, "0.0", true)
  );
  row++;
  writeScenarioRow(ws, row, "FY28 Target Market Cap (Cr)", v.fy28TargetMcapCr, (col, val) => writeNum(ws, row, col, val, CR_FORMAT));
  row++;
  writeScenarioRow(ws, row, "FY28 Target Price", v.fy28TargetPriceInr, (col, val) => writeNum(ws, row, col, val, PRICE_FORMAT));
  row++;
  writeScenarioRow(ws, row, "FY28 Upside %", v.fy28UpsidePct, (col, val) => writePct(ws, row, col, val));
  row++;
  writeScenarioRow(ws, row, "FY27 Discounted Price", v.fy27DiscountedPriceInr, (col, val) => writeNum(ws, row, col, val, PRICE_FORMAT));
  row++;
  writeScenarioRow(ws, row, "FY27 Upside %", v.fy27UpsidePct, (col, val) => writePct(ws, row, col, val));
  row++;
  writeScenarioRow(ws, row, "FY26 Discounted Price", v.fy26DiscountedPriceInr, (col, val) => writeNum(ws, row, col, val, PRICE_FORMAT));
  row++;
  writeScenarioRow(ws, row, "FY26 Upside %", v.fy26UpsidePct, (col, val) => writePct(ws, row, col, val));
  row += 2;

  writeBanner(ws, row, "Quarterly Averages — QAAUM", 4);
  row++;
  writeHeaderRow(ws, row, ["Period", "Val (Cr)", "QoQ", "YoY"]);
  row++;
  for (const r of sheet.qaaum) {
    writeLabel(ws, row, 1, r.label);
    writeNum(ws, row, 2, r.valCr, CR_FORMAT);
    writePct(ws, row, 3, r.qoqPct ?? null);
    writePct(ws, row, 4, r.yoyPct ?? null);
    row++;
  }
  row++;

  writeBanner(ws, row, "SIP AMC Growth", 5);
  row++;
  writeHeaderRow(ws, row, ["Period", "Val (Cr)", "QoQ", "YoY", "SIP/Equity AUM"]);
  row++;
  const sipAmcRows: [string, number | null, number | null][] = [
    [`Latest Available Quarter (${sheet.sipAmcLabels.qtd})`, m.sipAmcQtdValCr, m.sipAmcQtdPct],
    [`Previous Quarter (${sheet.sipAmcLabels.prevQ})`, m.sipAmcPrevQValCr, m.sipAmcPrevQPct],
    [`Previous Quarter (${sheet.sipAmcLabels.prevQ2})`, m.sipAmcPrevQ2ValCr, m.sipAmcPrevQ2Pct],
    [`Last Year Same Quarter (${sheet.sipAmcLabels.yoyQ})`, m.sipAmcYoyQValCr, m.sipAmcYoyQPct],
    [`Last Year Same Quarter (${sheet.sipAmcLabels.yoyQ2})`, m.sipAmcYoyQ2ValCr, m.sipAmcYoyQ2Pct],
  ];
  const sipAmcRatios = periodRatios(sipAmcRows.map(([, val]) => val));
  sipAmcRows.forEach(([label, val, pctVal], i) => {
    writeLabel(ws, row, 1, label);
    writeNum(ws, row, 2, val, PLAIN_FORMAT, true);
    writePct(ws, row, 3, sipAmcRatios.stepByRow[i]);
    writePct(ws, row, 4, sipAmcRatios.yoyByRow[i]);
    // Raw fraction + Excel's native "%" numFmt (not *100 -- Excel's own
    // percentage format multiplies by 100 for display), matching the tab's
    // own new "%" suffix on this cell and the PDF export's pct() call
    // below; blue input fill (not green/red) since this isn't a gain/loss
    // metric, just a manually-entered ratio.
    writeNum(ws, row, 5, pctVal, "0.0%", true);
    row++;
  });
  row++;

  writeBanner(ws, row, "SIP Industry Growth", 4);
  row++;
  writeHeaderRow(ws, row, ["Period", "Val (Cr)", "MoM", "YoY"]);
  row++;
  const industryAuto = sheet.sipIndustryAuto;
  const withPeriod = (base: string, period: string | undefined) => (period ? `${base} (${period})` : base);
  const sipIndustryRows: [string, number | null][] = [
    [withPeriod("Latest Available Month", industryAuto?.labels.qtd), m.sipIndustryMtdValCr ?? industryAuto?.values.mtd ?? null],
    [withPeriod("Previous Month", industryAuto?.labels.prevQ), m.sipIndustryPrevMValCr ?? industryAuto?.values.prevM ?? null],
    [withPeriod("Previous Month", industryAuto?.labels.prevQ2), m.sipIndustryPrevM2ValCr ?? industryAuto?.values.prevM2 ?? null],
    [withPeriod("Last Year Month", industryAuto?.labels.yoyQ), m.sipIndustryYoyMValCr ?? industryAuto?.values.yoyM ?? null],
    [withPeriod("Last Year Month", industryAuto?.labels.yoyQ2), m.sipIndustryYoyM2ValCr ?? industryAuto?.values.yoyM2 ?? null],
  ];
  const sipIndustryRatios = periodRatios(sipIndustryRows.map(([, val]) => val));
  sipIndustryRows.forEach(([label, val], i) => {
    writeLabel(ws, row, 1, label);
    writeNum(ws, row, 2, val, PLAIN_FORMAT, true);
    writePct(ws, row, 3, sipIndustryRatios.stepByRow[i]);
    writePct(ws, row, 4, sipIndustryRatios.yoyByRow[i]);
    row++;
  });
  row++;

  writeBanner(ws, row, "Ratio (Price / Avg AUM)", 2);
  row++;
  writeLabel(ws, row, 1, "SD Level");
  writeNum(ws, row, 2, sheet.ratio?.sdLevel ?? null, "0.00");
  row++;
  writeLabel(ws, row, 1, "Upside to Mean");
  writePct(ws, row, 2, sheet.ratio?.upsideToMeanPct ?? null);
  row++;
  writeLabel(ws, row, 1, "Time Period");
  writeLabel(ws, row, 2, sheet.ratio?.timePeriodLabel ?? "—");
  row++;
  writeLabel(ws, row, 1, "Avg AUM Days");
  writeLabel(ws, row, 2, sheet.ratio ? `${sheet.ratio.avgAumDays} Days` : "—");
  row++;
  writeLabel(ws, row, 1, "Correlation");
  writePct(ws, row, 2, sheet.ratio?.correlationPct ?? null);
  row++;
  writeLabel(ws, row, 1, "R-Square");
  writePct(ws, row, 2, sheet.ratio?.rSquared ?? null);
}
