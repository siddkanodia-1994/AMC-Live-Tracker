import type { Workbook, Worksheet } from "exceljs";
import { formatPct, formatShortDate } from "../utils/format";
import {
  parseSummaryRows,
  getEffectiveVerdictLabel,
  getAmcAbbreviation,
  formatFortnightlyPriceInr,
  type FortnightlySheet,
  type ScenarioValues,
} from "./fortnightly-update";

// Shared intermediate representation consumed by both the Excel (xlsx) and
// PDF (jsPDF/autotable) exporters, so the two can never drift out of sync
// with each other over what a "Fortnightly AMC Update" export actually
// contains -- each section becomes one worksheet block / one autoTable.
export interface ExportSection {
  title: string;
  // Stable identifier, independent of `title` -- the PDF's page-break and
  // column-width logic (fortnightly-download-panel.tsx) key off this
  // instead of the display title, since "AMC SIP Growth" is now
  // AMC-specific (e.g. "HDFC SIP Growth") and would otherwise silently
  // stop matching a hardcoded title string. Omitted for sections whose
  // title never changes and nothing else keys off it.
  key?: string;
  rows: string[][]; // first row is the header row
  // Optional per-body-cell color override, keyed by body row index then
  // column index (index 0 = the first row AFTER the header, matching
  // jspdf-autotable's own body row/column indices) -- used only where a
  // column's color can't be inferred from its own formatted text (e.g.
  // SIP/Equity AUM, a LEVEL that needs a continuous gradient instead of
  // the default sign-based "+"/"-" detector). An explicit RGB pair (not
  // just "pos"/"neg") so a continuously-interpolated gradient color can be
  // carried through, not just a binary choice. Sparse: a row/col with no
  // entry here falls through to the default sign-based detector.
  cellColors?: Record<number, Record<number, { fill: [number, number, number]; text: [number, number, number] }>>;
}

// Exported so fortnightly-download-panel.tsx's custom-drawn Overview
// banner (jsPDF primitives, not autoTable) can format the same way
// without duplicating this logic.
export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatPct(v, { alwaysSign: true }));
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
const score = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(2));
export const price = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `Rs.${formatFortnightlyPriceInr(v).slice(1)}`);

// jsPDF's built-in Helvetica font is missing glyphs for several Unicode
// characters the Overview card's free-text Summary can contain (the
// "Regenerate from data" draft itself uses all three) -- an unmappable
// character doesn't just show a stray mark, it corrupts autoTable/jsPDF's
// own character-width accounting for that line, which is what actually
// produced the bizarre letter-spacing seen across the WHOLE line, not
// just around the bad character (confirmed by fixing these 3 and the
// spacing resolving). "•" and "²" are both fine -- real WinAnsi-
// compatible glyphs -- so left untouched. PDF-only: the live UI and the
// Excel export both render all of these correctly already.
export function sanitizeForPdf(text: string): string {
  return text
    .replace(/₹/g, "Rs.")
    .replace(/→/g, "->")
    .replace(/σ/g, "SD");
}
const scenarioRow = (label: string, values: ScenarioValues, fmt: (v: number | null) => string): string[] => [
  label,
  fmt(values.bear),
  fmt(values.base),
  fmt(values.bull),
];

// "FY27 Discounted Price" -> "FY27 Discounted Price (20%)" -- the live UI
// shows this AMC's discount rate as its own separate editable row above
// the price row; the PDF has no room for that extra row, so it's folded
// into the label instead. Falls back to the plain label when no rate has
// been entered yet.
const withRateLabel = (base: string, ratePct: number | null) => (ratePct === null ? base : `${base} (${Math.round(ratePct * 100)}%)`);

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

  // Note: the PDF path no longer renders a generic "Overview" table here
  // -- it's custom-drawn in fortnightly-download-panel.tsx (a navy banner
  // matching the live dashboard's own Overview card), reading `sheet`
  // directly rather than this section shape. Excel's own Overview block
  // (buildFortnightlySheetExcel, below) is separate and unaffected.

  const header: ExportSection = {
    title: `${sheet.overviewName} — as of ${formatShortDate(sheet.asOfDate)}`,
    rows: [
      ["Stock", sheet.overviewName],
      ["CMP", price(sheet.cmpInr)],
      ["No of Shares (Cr)", m.noOfSharesCr === null ? "—" : String(m.noOfSharesCr)],
    ],
  };

  const pat: ExportSection = {
    title: "PAT Estimates (TUSK)",
    key: "pat",
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
    key: "valuation",
    rows: [
      ["", "Bear", "Base", "Bull"],
      scenarioRow("Target PE", { bear: m.targetPeBear, base: m.targetPeBase, bull: m.targetPeBull }, (x) => (x === null ? "—" : String(x))),
      scenarioRow("FY28 Target Market Cap (Cr)", v.fy28TargetMcapCr, cr),
      scenarioRow("FY28 Target Price", v.fy28TargetPriceInr, price),
      scenarioRow("FY28 Upside %", v.fy28UpsidePct, pct),
      scenarioRow(withRateLabel("FY27 Discounted Price", m.discountRateFy27Pct), v.fy27DiscountedPriceInr, price),
      scenarioRow("FY27 Upside %", v.fy27UpsidePct, pct),
      scenarioRow(withRateLabel("FY26 Discounted Price", m.discountRateFy26Pct), v.fy26DiscountedPriceInr, price),
      scenarioRow("FY26 Upside %", v.fy26UpsidePct, pct),
    ],
  };

  const qaaum: ExportSection = {
    title: "MTM Growth - Equity QAAUM",
    key: "mtm-growth-qaaum",
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
  // SIP/Equity AUM is a LEVEL, not a growth rate -- color column index 4
  // on a continuous all-green gradient across all 5 periods (highest =
  // this app's own green unchanged, lowest = a pale tint of it, 2-stop
  // direct blend), same rule/endpoints as the live tab's own
  // sipEquityAumGradientStyle, instead of the sign-based default (which
  // would mark this always-positive column always-green) or a red/green
  // scale (misleading -- every value here is positive).
  const sipAmcCellColors: Record<number, Record<number, { fill: [number, number, number]; text: [number, number, number] }>> = {};
  {
    const values = sipAmcRows.map(([, , p]) => p).filter((v): v is number => v !== null);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (values.length >= 2 && min !== max) {
      sipAmcRows.forEach(([, , p], i) => {
        if (p === null) return;
        const t = (p - min) / (max - min);
        sipAmcCellColors[i] = {
          4: {
            fill: [
              lerpChannel(GRADIENT_LOW_RGB[0], GRADIENT_HIGH_RGB[0], t),
              lerpChannel(GRADIENT_LOW_RGB[1], GRADIENT_HIGH_RGB[1], t),
              lerpChannel(GRADIENT_LOW_RGB[2], GRADIENT_HIGH_RGB[2], t),
            ],
            text: [
              lerpChannel(GRADIENT_LOW_TEXT_RGB[0], GRADIENT_HIGH_TEXT_RGB[0], t),
              lerpChannel(GRADIENT_LOW_TEXT_RGB[1], GRADIENT_HIGH_TEXT_RGB[1], t),
              lerpChannel(GRADIENT_LOW_TEXT_RGB[2], GRADIENT_HIGH_TEXT_RGB[2], t),
            ],
          },
        };
      });
    }
  }
  const sipAmc: ExportSection = {
    title: `${getAmcAbbreviation(sheet.amcId)} SIP Growth`,
    key: "sip-amc-growth",
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
    cellColors: sipAmcCellColors,
  };

  const withPeriod = (base: string, period: string | undefined) => (period ? `${base} (${period})` : base);

  const industryQtrAuto = sheet.sipIndustryQuarterlyAuto;
  const sipIndustryQtrRows: [string, number | null][] = [
    [withPeriod("Latest Available Quarter", industryQtrAuto?.labels.qtd), m.sipIndustryQtrQtdValCr ?? industryQtrAuto?.values.qtd ?? null],
    [withPeriod("Previous Quarter", industryQtrAuto?.labels.prevQ), m.sipIndustryQtrPrevQValCr ?? industryQtrAuto?.values.prevQ ?? null],
    [withPeriod("Previous Quarter", industryQtrAuto?.labels.prevQ2), m.sipIndustryQtrPrevQ2ValCr ?? industryQtrAuto?.values.prevQ2 ?? null],
    [withPeriod("Last Year Same Quarter", industryQtrAuto?.labels.yoyQ), m.sipIndustryQtrYoyQValCr ?? industryQtrAuto?.values.yoyQ ?? null],
    [withPeriod("Last Year Same Quarter", industryQtrAuto?.labels.yoyQ2), m.sipIndustryQtrYoyQ2ValCr ?? industryQtrAuto?.values.yoyQ2 ?? null],
  ];
  const sipIndustryQtrRatios = periodRatios(sipIndustryQtrRows.map(([, val]) => val));
  const qtrLatestVal = sipIndustryQtrRows[0][1];
  const qtrEstimate = industryQtrAuto?.estimate;
  const sipIndustryQuarterly: ExportSection = {
    title: "Industry SIP Growth (Quarterly)",
    key: "sip-industry-quarterly",
    rows: [
      ["Period", "Val (Cr)", "QoQ", "YoY"],
      ...sipIndustryQtrRows.map(([label, val], i) => [label, cr(val), pct(sipIndustryQtrRatios.stepByRow[i]), pct(sipIndustryQtrRatios.yoyByRow[i])]),
      ...(qtrEstimate
        ? [
            [
              qtrEstimate.label,
              cr(qtrEstimate.valueCr),
              pct(qtrLatestVal !== null && qtrLatestVal !== 0 ? qtrEstimate.valueCr / qtrLatestVal - 1 : null),
              pct(qtrEstimate.yoyPct),
            ],
          ]
        : []),
    ],
  };

  const industryAuto = sheet.sipIndustryAuto;
  const sipIndustryRows: [string, number | null][] = [
    [withPeriod("Latest Available Month", industryAuto?.labels.qtd), m.sipIndustryMtdValCr ?? industryAuto?.values.mtd ?? null],
    [withPeriod("Previous Month", industryAuto?.labels.prevQ), m.sipIndustryPrevMValCr ?? industryAuto?.values.prevM ?? null],
    [withPeriod("Previous Month", industryAuto?.labels.prevQ2), m.sipIndustryPrevM2ValCr ?? industryAuto?.values.prevM2 ?? null],
    [withPeriod("Last Year Month", industryAuto?.labels.yoyQ), m.sipIndustryYoyMValCr ?? industryAuto?.values.yoyM ?? null],
    [withPeriod("Last Year Month", industryAuto?.labels.yoyQ2), m.sipIndustryYoyM2ValCr ?? industryAuto?.values.yoyM2 ?? null],
  ];
  const sipIndustryRatios = periodRatios(sipIndustryRows.map(([, val]) => val));
  const monthlyLatestVal = sipIndustryRows[0][1];
  const monthlyEstimate = industryAuto?.estimate;
  const sipIndustryMonthly: ExportSection = {
    title: "Industry SIP Growth (Monthly)",
    key: "sip-industry-monthly",
    rows: [
      ["Period", "Val (Cr)", "MoM", "YoY"],
      ...sipIndustryRows.map(([label, val], i) => [label, cr(val), pct(sipIndustryRatios.stepByRow[i]), pct(sipIndustryRatios.yoyByRow[i])]),
      ...(monthlyEstimate
        ? [
            [
              monthlyEstimate.label,
              cr(monthlyEstimate.valueCr),
              pct(monthlyLatestVal !== null && monthlyLatestVal !== 0 ? monthlyEstimate.valueCr / monthlyLatestVal - 1 : null),
              pct(monthlyEstimate.yoyPct),
            ],
          ]
        : []),
    ],
  };

  const ratio: ExportSection = {
    title: "Ratio (Price / Avg AUM)",
    key: "ratio",
    rows: [
      ["SD Level", sheet.ratio?.sdLevel === null || sheet.ratio?.sdLevel === undefined ? "—" : sheet.ratio.sdLevel.toFixed(2)],
      ["Upside to Mean", pct(sheet.ratio?.upsideToMeanPct ?? null)],
      ["Mean Target Price", price(sheet.ratio?.fairValueAtMeanInr ?? null)],
      ["Time Period", sheet.ratio?.timePeriodLabel ?? "—"],
      ["Avg AUM Days", sheet.ratio ? `${sheet.ratio.avgAumDays} Days` : "—"],
      ["Correlation", pct(sheet.ratio?.correlationPct ?? null)],
      ["R-Square", pct(sheet.ratio?.rSquared ?? null)],
    ],
  };

  const amcScore: ExportSection = {
    title: "AMC Score",
    key: "amc-score",
    rows: [
      ["Period", "Score", "Change"],
      ...(sheet.amcScore?.rows.map((r) => [r.label, score(r.score), pct(r.changePct)]) ?? [["No AMC Score data available for this fund.", "—", "—"]]),
    ],
  };

  return [header, pat, valuation, qaaum, sipAmc, sipIndustryQuarterly, sipIndustryMonthly, ratio, amcScore];
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
const PRICE_FORMAT = '"₹"#,##0.0';
const PCT_FORMAT = "+0.00%;-0.00%";
const SCORE_FORMAT = "0.00";

const POS_FILL = "FFC6EFCE";
const POS_FONT = "FF006100";
const NEG_FILL = "FFFFC7CE";
const NEG_FONT = "FF9C0006";
const BANNER_FILL = "FF000000";
const BANNER_FONT = "FFFFFFFF";
const INPUT_FILL = "FFD7ECFF"; // the dashboard's own input-cell shade

// Same explicitly-signed-percentage detector as the live Analyst Summary
// card's SummaryTable (fortnightly-update-panel.tsx) -- a bare-magnitude
// percentage (SIP/Equity AUM's ratio level, correlation %, R²) is never
// given a forced sign, so it's naturally left out of this match.
const SIGNED_PCT_RE = /[+-]\d[\d,.]*%/g;

// XLSX rich-text runs only carry font properties (bold/color/etc), never a
// per-run background fill -- a true chip (colored rect behind the text,
// like the live card and the PDF) isn't representable inline within one
// cell's flowing text, only as a whole-cell fill. Bold + colored text is
// the closest equivalent Excel actually supports here.
function buildSummaryDetailRichText(detail: string, baseFontColorArgb: string): { richText: { text: string; font?: Record<string, unknown> }[] } {
  const runs: { text: string; font?: Record<string, unknown> }[] = [];
  let lastIndex = 0;
  SIGNED_PCT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SIGNED_PCT_RE.exec(detail)) !== null) {
    if (match.index > lastIndex) runs.push({ text: detail.slice(lastIndex, match.index), font: { color: { argb: baseFontColorArgb } } });
    const positive = match[0].startsWith("+");
    runs.push({ text: match[0], font: { bold: true, color: { argb: positive ? POS_FONT : NEG_FONT } } });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < detail.length) runs.push({ text: detail.slice(lastIndex), font: { color: { argb: baseFontColorArgb } } });
  return { richText: runs };
}

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

function lerpChannel(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

function toHex2(n: number): string {
  return n.toString(16).padStart(2, "0").toUpperCase();
}

function interpolateArgb(from: [number, number, number], to: [number, number, number], t: number): string {
  return `FF${toHex2(lerpChannel(from[0], to[0], t))}${toHex2(lerpChannel(from[1], to[1], t))}${toHex2(lerpChannel(from[2], to[2], t))}`;
}

const GRADIENT_LOW_RGB: [number, number, number] = [240, 249, 242]; // pale tint of the app's own green
const GRADIENT_LOW_TEXT_RGB: [number, number, number] = [90, 140, 100];
const GRADIENT_HIGH_RGB: [number, number, number] = [198, 239, 206]; // matches POS_FILL -- unchanged, the ceiling
const GRADIENT_HIGH_TEXT_RGB: [number, number, number] = [0, 97, 0]; // matches POS_FONT

// SIP/Equity AUM is a LEVEL (always positive), not a growth rate -- a
// red-to-green gradient was tried first but rejected (every value here is
// positive, so the lowest of five healthy numbers reading as "red" was
// misleading). Colored instead on an ALL-GREEN gradient across the whole
// 5-period set: the HIGHEST value gets exactly this app's existing
// positive green (unchanged, the ceiling), the LOWEST fades to a pale tint
// of that same hue (2-stop direct blend, confirmed with the user via a
// live preview -- not a 3-stop scale). Same rule/hex endpoints as the live
// tab's own sipEquityAumGradientStyle (fortnightly-update-panel.tsx).
// Falls back to the plain blue input fill when fewer than 2 distinct
// values exist to form a range from.
function writeConditionalPctInput(ws: Worksheet, row: number, col: number, value: number | null, allValues: (number | null)[]): void {
  const cell = ws.getCell(row, col);
  if (value === null) {
    cell.value = "—";
    cell.alignment = { horizontal: "right" };
    return;
  }
  cell.value = value;
  cell.numFmt = "0.0%";
  cell.alignment = { horizontal: "right" };
  const values = allValues.filter((v): v is number => v !== null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (values.length < 2 || min === max) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT_FILL } };
    return;
  }
  const t = (value - min) / (max - min);
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: interpolateArgb(GRADIENT_LOW_RGB, GRADIENT_HIGH_RGB, t) } };
  cell.font = { bold: true, color: { argb: interpolateArgb(GRADIENT_LOW_TEXT_RGB, GRADIENT_HIGH_TEXT_RGB, t) } };
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

// The SIP Industry cards' "(Estimated)" next-period row -- italic, no
// input fill (it's never manually editable, unlike every other Val cell
// in these two sections), matching the live tab's own
// "italic text-muted-foreground" treatment for this row.
function writeEstimateRow(ws: Worksheet, row: number, label: string, valueCr: number, stepPct: number | null, yoyPct: number | null): void {
  const labelCell = ws.getCell(row, 1);
  labelCell.value = label;
  labelCell.font = { italic: true };
  const valueCell = ws.getCell(row, 2);
  valueCell.value = valueCr;
  valueCell.numFmt = PLAIN_FORMAT;
  valueCell.alignment = { horizontal: "right" };
  valueCell.font = { italic: true };
  writePct(ws, row, 3, stepPct);
  writePct(ws, row, 4, yoyPct);
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

  const effectiveVerdict = getEffectiveVerdictLabel(m, sheet.autoVerdict);
  writeBanner(ws, row, "Overview", 5);
  row++;
  writeLabel(ws, row, 1, "CMP");
  writeNum(ws, row, 2, sheet.cmpInr, PRICE_FORMAT);
  row++;
  writeLabel(ws, row, 1, "Target Price (Base)");
  writeNum(ws, row, 2, v.fy28TargetPriceInr.base, PRICE_FORMAT);
  row++;
  writeLabel(ws, row, 1, "Upside (Base)");
  writePct(ws, row, 2, v.fy28UpsidePct.base);
  row++;
  writeLabel(ws, row, 1, "Target Period");
  writeLabel(ws, row, 2, "FY28E");
  row++;
  writeLabel(ws, row, 1, "Verdict");
  writeLabel(ws, row, 2, effectiveVerdict.label);
  row++;
  writeLabel(ws, row, 1, "Summary");
  row++;
  {
    // Two-column (bold Label | Detail) rows inside a dedicated light-blue
    // box -- lighter than this app's usual manual-input blue (INPUT_FILL),
    // confirmed via preview after an earlier round of options wasn't light
    // enough. parseSummaryRows (shared with the live table and the PDF
    // export) is the single source of truth for "• Label: detail" vs. a
    // continuation line (e.g. QAAUM's previous-quarter figures, folded
    // into the same row's detail as an embedded "\n" -- ExcelJS's
    // wrapText renders that as a 2nd line within the one cell).
    const rows = parseSummaryRows(m.summary);
    const SUMMARY_BOX_FILL_ARGB = "FFF5FAFF";
    const BOX_BORDER_ARGB = "FFD7E8F7";
    const TEXT_ARGB = "FF0B2338";
    rows.forEach((r, i) => {
      const border = {
        top: i === 0 ? ({ style: "thin", color: { argb: BOX_BORDER_ARGB } } as const) : undefined,
        bottom: { style: "thin", color: { argb: BOX_BORDER_ARGB } } as const,
        left: { style: "thin", color: { argb: BOX_BORDER_ARGB } } as const,
        right: { style: "thin", color: { argb: BOX_BORDER_ARGB } } as const,
      };

      const labelCell = ws.getCell(row, 1);
      labelCell.value = r.label;
      labelCell.font = { bold: true, color: { argb: TEXT_ARGB } };
      labelCell.alignment = { vertical: "top", wrapText: true };
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUMMARY_BOX_FILL_ARGB } };
      labelCell.border = border;

      ws.mergeCells(row, 2, row, 5);
      const detailCell = ws.getCell(row, 2);
      detailCell.value = buildSummaryDetailRichText(r.detail, TEXT_ARGB);
      detailCell.alignment = { vertical: "top", wrapText: true };
      detailCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUMMARY_BOX_FILL_ARGB } };
      detailCell.border = border;

      // Height accounts for both explicit continuation lines (embedded
      // "\n") and natural text-wrapping of a long single line, whichever
      // needs more room.
      const embeddedLines = r.detail.split("\n").length;
      const wrappedLines = Math.ceil(r.detail.length / 70);
      ws.getRow(row).height = Math.max(16, Math.max(embeddedLines, wrappedLines) * 14);
      row++;
    });
  }
  row += 1;

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

  writeBanner(ws, row, "PAT Estimates (TUSK)", 5);
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

  writeBanner(ws, row, "MTM Growth - Equity QAAUM", 4);
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

  writeBanner(ws, row, `${getAmcAbbreviation(sheet.amcId)} SIP Growth`, 5);
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
    // below; gradient-colored across all 5 periods (see
    // writeConditionalPctInput), not a flat blue input fill.
    writeConditionalPctInput(
      ws,
      row,
      5,
      pctVal,
      sipAmcRows.map(([, , p]) => p)
    );
    row++;
  });
  row++;

  const withPeriod = (base: string, period: string | undefined) => (period ? `${base} (${period})` : base);

  writeBanner(ws, row, "Industry SIP Growth (Quarterly)", 4);
  row++;
  writeHeaderRow(ws, row, ["Period", "Val (Cr)", "QoQ", "YoY"]);
  row++;
  const industryQtrAuto = sheet.sipIndustryQuarterlyAuto;
  const sipIndustryQtrRows: [string, number | null][] = [
    [withPeriod("Latest Available Quarter", industryQtrAuto?.labels.qtd), m.sipIndustryQtrQtdValCr ?? industryQtrAuto?.values.qtd ?? null],
    [withPeriod("Previous Quarter", industryQtrAuto?.labels.prevQ), m.sipIndustryQtrPrevQValCr ?? industryQtrAuto?.values.prevQ ?? null],
    [withPeriod("Previous Quarter", industryQtrAuto?.labels.prevQ2), m.sipIndustryQtrPrevQ2ValCr ?? industryQtrAuto?.values.prevQ2 ?? null],
    [withPeriod("Last Year Same Quarter", industryQtrAuto?.labels.yoyQ), m.sipIndustryQtrYoyQValCr ?? industryQtrAuto?.values.yoyQ ?? null],
    [withPeriod("Last Year Same Quarter", industryQtrAuto?.labels.yoyQ2), m.sipIndustryQtrYoyQ2ValCr ?? industryQtrAuto?.values.yoyQ2 ?? null],
  ];
  const sipIndustryQtrRatios = periodRatios(sipIndustryQtrRows.map(([, val]) => val));
  sipIndustryQtrRows.forEach(([label, val], i) => {
    writeLabel(ws, row, 1, label);
    writeNum(ws, row, 2, val, PLAIN_FORMAT, true);
    writePct(ws, row, 3, sipIndustryQtrRatios.stepByRow[i]);
    writePct(ws, row, 4, sipIndustryQtrRatios.yoyByRow[i]);
    row++;
  });
  if (industryQtrAuto?.estimate) {
    const qtrLatestVal = sipIndustryQtrRows[0][1];
    const est = industryQtrAuto.estimate;
    writeEstimateRow(ws, row, est.label, est.valueCr, qtrLatestVal !== null && qtrLatestVal !== 0 ? est.valueCr / qtrLatestVal - 1 : null, est.yoyPct);
    row++;
  }
  row++;

  writeBanner(ws, row, "Industry SIP Growth (Monthly)", 4);
  row++;
  writeHeaderRow(ws, row, ["Period", "Val (Cr)", "MoM", "YoY"]);
  row++;
  const industryAuto = sheet.sipIndustryAuto;
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
  if (industryAuto?.estimate) {
    const monthlyLatestVal = sipIndustryRows[0][1];
    const est = industryAuto.estimate;
    writeEstimateRow(ws, row, est.label, est.valueCr, monthlyLatestVal !== null && monthlyLatestVal !== 0 ? est.valueCr / monthlyLatestVal - 1 : null, est.yoyPct);
    row++;
  }
  row++;

  writeBanner(ws, row, "Ratio (Price / Avg AUM)", 2);
  row++;
  writeLabel(ws, row, 1, "SD Level");
  writeNum(ws, row, 2, sheet.ratio?.sdLevel ?? null, "0.00");
  row++;
  writeLabel(ws, row, 1, "Upside to Mean");
  writePct(ws, row, 2, sheet.ratio?.upsideToMeanPct ?? null);
  row++;
  writeLabel(ws, row, 1, "Mean Target Price");
  writeNum(ws, row, 2, sheet.ratio?.fairValueAtMeanInr ?? null, PRICE_FORMAT);
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
  row += 2;

  writeBanner(ws, row, "AMC Score", 3);
  row++;
  writeHeaderRow(ws, row, ["Period", "Score", "Change"]);
  row++;
  if (sheet.amcScore) {
    for (const r of sheet.amcScore.rows) {
      writeLabel(ws, row, 1, r.label);
      writeNum(ws, row, 2, r.score, SCORE_FORMAT);
      writePct(ws, row, 3, r.changePct);
      row++;
    }
  } else {
    writeLabel(ws, row, 1, "No AMC Score data available for this fund.");
  }
}
