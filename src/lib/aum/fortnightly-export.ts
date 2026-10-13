import { formatCr, formatPct, formatPriceInr, formatShortDate } from "../utils/format";
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
const cr = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatCr(v));
const price = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatPriceInr(v));
const scenarioRow = (label: string, values: ScenarioValues, fmt: (v: number | null) => string): string[] => [
  label,
  fmt(values.bear),
  fmt(values.base),
  fmt(values.bull),
];

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
        m.patFy26aCr === null ? "—" : String(m.patFy26aCr),
        m.patFy27eCr === null ? "—" : String(m.patFy27eCr),
        m.patFy28eCr === null ? "—" : String(m.patFy28eCr),
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
  const sipAmc: ExportSection = {
    title: "SIP AMC Growth",
    rows: [["Period", "Val (Cr)", "SIP/Equity AUM"], ...sipAmcRows.map(([label, val, p]) => [label, cr(val), p === null ? "—" : pct(p)])],
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
  const sipIndustry: ExportSection = {
    title: "SIP Industry Growth",
    rows: [["Period", "Val (Cr)"], ...sipIndustryRows.map(([label, val]) => [label, cr(val)])],
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
