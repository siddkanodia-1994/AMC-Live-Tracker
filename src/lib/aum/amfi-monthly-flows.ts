// Automatic pull of AMFI's monthly industry figures into
// industry_monthly_flow, replacing the hand-typed Admin form entry.
// AMFI publishes the two columns in two different files:
//   - SIP contributions: only in the AMFI Monthly Note (a CRISIL PDF). Its
//     link carries a CMS hash, so it's found by scraping the listing page.
//     Its "SIP monthly contribution (crore)" row also repeats the previous
//     6 months, which is how AMFI revisions are picked up.
//   - Equity net flows: the AMFI Monthly Report (XLS, fixed URL per month),
//     open-ended "Equity Schemes" block, "Sub Total - II" row, net inflow.
// The parsers below are pure (tested); runAmfiMonthlyFlowIngestion does
// the fetching and writing and runs as a daily-snapshot cron step.

import { read, utils } from "xlsx";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface TargetMonth {
  year: number;
  /** 1–12 */
  month: number;
}

export function monthEndDate({ year, month }: TargetMonth): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function shiftTarget({ year, month }: TargetMonth, n: number): TargetMonth {
  const idx = year * 12 + (month - 1) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** The month AMFI reports next: the calendar month before today's (IST) date. */
export function targetMonthFor(istDate: string): TargetMonth {
  const [y, m] = istDate.split("-").map(Number);
  return shiftTarget({ year: y, month: m }, -1);
}

export function monthlyReportUrl({ year, month }: TargetMonth): string {
  return `https://portal.amfiindia.com/spages/am${MONTHS[month - 1].slice(0, 3).toLowerCase()}${year}repo.xls`;
}

export const MONTHLY_NOTE_LISTING_URL = "https://www.amfiindia.com/otherdata/amfi-monthlynote";

const toNumber = (s: string) => Number(s.replace(/,/g, ""));

/**
 * The target month's PDF link on the Monthly Note listing page: each entry
 * is a "<p>October 2026</p>" label followed by its PDF link.
 */
export function findMonthlyNoteUrl(html: string, target: TargetMonth): string | null {
  const label = `${MONTHS[target.month - 1]} ${target.year}`;
  const labelRe = new RegExp(`>\\s*${label}\\s*<`, "i");
  const at = html.search(labelRe);
  if (at < 0) return null;
  const rest = html.slice(at + 1);
  // Stop at the next month label so a missing link never borrows a neighbour's.
  const nextLabel = rest.search(new RegExp(`>\\s*(?:${MONTHS.join("|")})\\s+\\d{4}\\s*<`, "i"));
  const scope = nextLabel >= 0 ? rest.slice(0, nextLabel) : rest;
  const href = scope.match(/href="([^"]+\.pdf)"/i)?.[1];
  if (!href) return null;
  return new URL(href, MONTHLY_NOTE_LISTING_URL).toString();
}

export interface MonthlyNoteSip {
  /** The note's own month. */
  sipCr: number;
  /** The same row's earlier months, newest first (target − 1, − 2, …). */
  previous: number[];
}

/**
 * SIP from the Monthly Note's text. Throws when the note is for another
 * month, the row is missing, or the narrative figure disagrees.
 */
export function parseMonthlyNoteSip(text: string, target: TargetMonth): MonthlyNoteSip {
  const flat = text.replace(/\s+/g, " ");
  const title = flat.match(new RegExp(`AMFI monthly note (${MONTHS.join("|")}) (\\d{4})`, "i"));
  if (!title) throw new Error("Monthly Note: title month not found");
  const titleMonth = MONTHS.findIndex((m) => m.toLowerCase() === title[1].toLowerCase()) + 1;
  if (titleMonth !== target.month || Number(title[2]) !== target.year) {
    throw new Error(`Monthly Note is for ${title[1]} ${title[2]}, expected ${MONTHS[target.month - 1]} ${target.year}`);
  }
  const row = flat.match(/SIP monthly contribution \(crore\)((?: [\d,]+){1,7})/i);
  if (!row) throw new Error("Monthly Note: 'SIP monthly contribution (crore)' row not found");
  const values = row[1].trim().split(" ").map(toNumber);
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) throw new Error(`Monthly Note: bad SIP row "${row[1].trim()}"`);
  // The narrative bullet ("…(SIPs) stood at / amounted to Rs 32,160 crore")
  // must agree when present; its wording changes, so it's only a cross-check.
  const bullet = flat.match(/systematic investment plans? \(SIPs?\)[^.]{0,60}?Rs\.? ?([\d,]+) crore/i);
  if (bullet && toNumber(bullet[1]) !== values[0]) {
    throw new Error(`Monthly Note: SIP row ${values[0]} disagrees with the summary's Rs ${bullet[1]} crore`);
  }
  return { sipCr: values[0], previous: values.slice(1) };
}

/** Equity net flows from the Monthly Report sheet (rows as SheetJS header:1 arrays). */
export function parseMonthlyReportEquityNet(rows: unknown[][], target: TargetMonth): number {
  const cell = (r: unknown[] | undefined, i: number) => (r?.[i] == null ? "" : String(r[i]).trim());
  const headerIdx = rows.findIndex((r) => r.some((c) => /Net Inflow/i.test(String(c ?? ""))));
  if (headerIdx < 0) throw new Error("Monthly Report: header row not found");
  const header = rows[headerIdx];
  const netCol = header.findIndex((c) => /Net Inflow/i.test(String(c ?? "")));
  const label = `${MONTHS[target.month - 1]} ${target.year}`;
  if (!new RegExp(label, "i").test(String(header[netCol]))) {
    throw new Error(`Monthly Report: net inflow column is not for ${label}`);
  }
  // The open-ended "Equity Schemes" block comes first; the closed-ended
  // block further down labels its total "Sub Total II" (no dash).
  const blockIdx = rows.findIndex((r, i) => i > headerIdx && /^Equity Schemes$/i.test(cell(r, 1)));
  if (blockIdx < 0) throw new Error("Monthly Report: 'Equity Schemes' block not found");
  for (let i = blockIdx + 1; i < rows.length; i++) {
    const name = cell(rows[i], 1);
    if (/^Sub Total\s*-\s*II\b(?!I)/i.test(name)) {
      const v = Number(rows[i][netCol]);
      if (!Number.isFinite(v)) throw new Error("Monthly Report: equity net inflow is not a number");
      return Math.round(v * 100) / 100;
    }
    if (/^Sub Total/i.test(name)) break;
  }
  throw new Error("Monthly Report: equity 'Sub Total - II' row not found");
}

export function readReportRows(buffer: ArrayBuffer): unknown[][] {
  const wb = read(new Uint8Array(buffer), { type: "array" });
  return utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null }) as unknown[][];
}

export async function pdfText(buffer: ArrayBuffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

/** A new month's SIP more than this far from the month before is treated as a parse error. */
export const SIP_SANITY_BAND = 0.15;

export interface FlowRow {
  monthEndDate: string;
  sipContributionsCr: number;
  equityNetFlowsCr: number;
}

export interface IngestionPlan {
  write: FlowRow;
  /** Earlier months whose SIP AMFI has since revised (equity kept as stored). */
  revisions: { monthEndDate: string; fromCr: number; toCr: number; equityNetFlowsCr: number }[];
}

/** Decide what to write from the parsed figures and the rows already stored. Throws on a sanity failure. */
export function planIngestion(target: TargetMonth, sip: MonthlyNoteSip, equityNetCr: number, existing: readonly FlowRow[]): IngestionPlan {
  const byMonth = new Map(existing.map((r) => [r.monthEndDate, r]));
  const prior = byMonth.get(monthEndDate(shiftTarget(target, -1)));
  // Checked against what's stored, not the note's own row, so a misread row can't vouch for itself.
  const priorSip = prior?.sipContributionsCr ?? sip.previous[0];
  if (priorSip !== undefined && Math.abs(sip.sipCr / priorSip - 1) > SIP_SANITY_BAND) {
    throw new Error(`SIP ${sip.sipCr} is more than ${SIP_SANITY_BAND * 100}% from the previous month's ${priorSip}`);
  }
  const revisions: IngestionPlan["revisions"] = [];
  sip.previous.forEach((v, i) => {
    const key = monthEndDate(shiftTarget(target, -(i + 1)));
    const row = byMonth.get(key);
    if (row && Math.abs(row.sipContributionsCr - v) >= 0.5) {
      revisions.push({ monthEndDate: key, fromCr: row.sipContributionsCr, toCr: v, equityNetFlowsCr: row.equityNetFlowsCr });
    }
  });
  return { write: { monthEndDate: monthEndDate(target), sipContributionsCr: sip.sipCr, equityNetFlowsCr: equityNetCr }, revisions };
}

/** AMFI's Monthly Report lands around the 10th–12th; nothing to look for before the 8th. */
export const FIRST_CHECK_DAY = 8;

export interface AmfiIngestionResult {
  status: "written" | "up-to-date" | "too-early" | "not-published";
  month: string;
  summary: string;
  write?: FlowRow;
  revisions?: IngestionPlan["revisions"];
  warnings?: string[];
}

interface IngestionDeps {
  istDate: string;
  fetchImpl?: typeof fetch;
  existing: () => Promise<FlowRow[]>;
  upsert: (row: FlowRow) => Promise<void>;
  /** Parse and plan only; never write. */
  dryRun?: boolean;
  /** For tests: XLS bytes → rows (defaults to SheetJS). */
  readRows?: (buffer: ArrayBuffer) => unknown[][];
  /** For tests: PDF bytes → text (defaults to unpdf). */
  extractPdfText?: (buffer: ArrayBuffer) => Promise<string>;
}

const UA = { "User-Agent": "Mozilla/5.0 (compatible; amc-live-aum-tracker/1.0)" };

/**
 * Daily (cron) check: once the previous month's row is missing and it's
 * the 8th or later, fetch both AMFI files, parse, sanity-check, write the
 * month and apply any SIP revisions to earlier months. A month AMFI hasn't
 * published yet is a quiet "not-published"; a parse problem throws so the
 * cron step shows as failed in the ops ledger.
 */
export async function runAmfiMonthlyFlowIngestion(deps: IngestionDeps): Promise<AmfiIngestionResult> {
  const doFetch = deps.fetchImpl ?? fetch;
  const target = targetMonthFor(deps.istDate);
  const month = monthEndDate(target);
  const label = `${MONTHS[target.month - 1]} ${target.year}`;
  const existing = await deps.existing();
  if (existing.some((r) => r.monthEndDate === month)) {
    return { status: "up-to-date", month, summary: `${label} already stored` };
  }
  if (Number(deps.istDate.slice(8, 10)) < FIRST_CHECK_DAY) {
    return { status: "too-early", month, summary: `${label} not expected before the ${FIRST_CHECK_DAY}th` };
  }

  const reportRes = await doFetch(monthlyReportUrl(target), { headers: UA, cache: "no-store" });
  if (reportRes.status === 404) return { status: "not-published", month, summary: `${label} Monthly Report not out yet` };
  if (!reportRes.ok) throw new Error(`Monthly Report fetch failed: HTTP ${reportRes.status}`);
  const equityNetCr = parseMonthlyReportEquityNet((deps.readRows ?? readReportRows)(await reportRes.arrayBuffer()), target);

  const listingRes = await doFetch(MONTHLY_NOTE_LISTING_URL, { headers: UA, cache: "no-store" });
  if (!listingRes.ok) throw new Error(`Monthly Note listing fetch failed: HTTP ${listingRes.status}`);
  const noteUrl = findMonthlyNoteUrl(await listingRes.text(), target);
  // The note usually follows the report by a few hours to a day.
  if (!noteUrl) return { status: "not-published", month, summary: `${label} Monthly Note not out yet (report is)` };
  const noteRes = await doFetch(noteUrl, { headers: UA, cache: "no-store" });
  if (!noteRes.ok) throw new Error(`Monthly Note fetch failed: HTTP ${noteRes.status}`);
  const sip = parseMonthlyNoteSip(await (deps.extractPdfText ?? pdfText)(await noteRes.arrayBuffer()), target);

  const plan = planIngestion(target, sip, equityNetCr, existing);
  if (!deps.dryRun) {
    await deps.upsert(plan.write);
    for (const r of plan.revisions) {
      await deps.upsert({ monthEndDate: r.monthEndDate, sipContributionsCr: r.toCr, equityNetFlowsCr: r.equityNetFlowsCr });
    }
  }
  const revText = plan.revisions.map((r) => `${r.monthEndDate.slice(0, 7)} ${r.fromCr}→${r.toCr}`).join(", ");
  return {
    status: "written",
    month,
    summary: `${deps.dryRun ? "[dry run] " : ""}${label}: SIP ${sip.sipCr}, equity net ${equityNetCr}${revText ? `; SIP revised ${revText}` : ""}`,
    write: plan.write,
    revisions: plan.revisions,
    // Revisions rewrite stored history, so they surface as a warning in the ops ledger.
    warnings: plan.revisions.length > 0 ? [`AMFI revised SIP for ${revText}`] : undefined,
  };
}
