import accordCodesJson from "../../../data/amc-accord-codes.json";

// Parses the user's Ace Equity "Query Expression" export: one sheet, a title
// row, a header row (Accord Code | Company Name | NDP_Date | NDP_PE |
// NDP_Consolidated PE | NDP_Consolidated MCAP NS | NDP_MCAP_NS), one row per
// AMC per date, then a source/disclaimer footer. Columns are found by header
// name, not position, so a re-ordered export still parses. Runs in the
// browser (the tab's upload) and in tests -- no I/O and no xlsx import.

export const VALUATION_FIELDS = ["peCons", "peSa", "mcapNsCons", "mcapNsSa"] as const;
export type ValuationField = (typeof VALUATION_FIELDS)[number];

export interface ValuationRow {
  slug: string;
  date: string;
  peCons: number | null;
  peSa: number | null;
  mcapNsCons: number | null;
  mcapNsSa: number | null;
}

export interface ParsedValuationFile {
  rows: ValuationRow[];
  errors: string[];
}

// Accord Code -> this app's AMC slug (+ the listed company's own name, used
// in the chart titles). Codes are public identifiers, so this map is safe
// to commit; the valuation values themselves never are.
export const ACCORD_CODES: Record<string, { slug: string; company: string }> = accordCodesJson;
const ACCORD_CODE_TO_SLUG = Object.fromEntries(Object.entries(ACCORD_CODES).map(([code, v]) => [code, v.slug]));

const HEADERS: Record<"code" | "date" | ValuationField, string> = {
  code: "accord code",
  date: "ndp_date",
  peSa: "ndp_pe",
  peCons: "ndp_consolidated pe",
  mcapNsCons: "ndp_consolidated mcap ns",
  mcapNsSa: "ndp_mcap_ns",
};

const MAX_ERRORS = 20;

// Excel stores dates as day serials (1 = 1900-01-01, with Excel's fake
// 1900-02-29, so day 25569 is 1970-01-01). Converting the serial directly
// is timezone-proof: no JS Date in local time is ever involved.
function excelSerialToIsoDate(serial: number): string {
  return new Date(Math.round(serial - 25569) * 86_400_000).toISOString().slice(0, 10);
}

function toIsoDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return excelSerialToIsoDate(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return null;
}

function toMultiple(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined; // present but not a number -- reported as an error
}

/**
 * Parses the first sheet's rows as array-of-arrays (xlsx's
 * `sheet_to_json(sheet, { header: 1, raw: true, defval: null })`). The
 * caller does the xlsx read, so this module stays free of the xlsx bundle
 * (the tab loads it lazily, only when a file is dropped).
 */
export function parseValuationRows(sheetRows: unknown[][]): ParsedValuationFile {
  const errors: string[] = [];
  const pushError = (msg: string) => {
    if (errors.length < MAX_ERRORS) errors.push(msg);
  };

  const headerIdx = sheetRows.findIndex((r) => r.some((c) => typeof c === "string" && c.trim().toLowerCase() === HEADERS.code));
  if (headerIdx === -1) return { rows: [], errors: ["Header row not found: expected an 'Accord Code' column."] };
  const header = sheetRows[headerIdx].map((c) => (typeof c === "string" ? c.trim().toLowerCase() : ""));
  const col = Object.fromEntries(Object.entries(HEADERS).map(([key, name]) => [key, header.indexOf(name)])) as Record<keyof typeof HEADERS, number>;
  const missing = Object.entries(col).filter(([, idx]) => idx === -1).map(([key]) => HEADERS[key as keyof typeof HEADERS]);
  if (missing.length > 0) return { rows: [], errors: [`Missing column(s): ${missing.join(", ")}.`] };

  const rows: ValuationRow[] = [];
  const seen = new Set<string>();
  for (let i = headerIdx + 1; i < sheetRows.length; i++) {
    const r = sheetRows[i];
    const rawCode = r[col.code];
    // Title/footer/blank rows have no numeric Accord Code -- skip silently.
    if (typeof rawCode !== "number" && !(typeof rawCode === "string" && /^\d+$/.test(rawCode.trim()))) continue;
    const excelRow = i + 1;
    const slug = ACCORD_CODE_TO_SLUG[String(rawCode).trim()];
    if (!slug) {
      pushError(`Row ${excelRow}: unknown Accord Code ${rawCode} -- not one of the 8 listed AMCs.`);
      continue;
    }
    const date = toIsoDate(r[col.date]);
    if (!date) {
      pushError(`Row ${excelRow}: unreadable date.`);
      continue;
    }
    const values = {} as Record<ValuationField, number | null>;
    let bad = false;
    for (const field of VALUATION_FIELDS) {
      const v = toMultiple(r[col[field]]);
      if (v === undefined) {
        pushError(`Row ${excelRow}: ${HEADERS[field]} is not a number.`);
        bad = true;
      } else {
        values[field] = v;
      }
    }
    if (bad) continue;
    const key = `${slug}|${date}`;
    if (seen.has(key)) {
      pushError(`Row ${excelRow}: duplicate date ${date} for ${slug}.`);
      continue;
    }
    seen.add(key);
    rows.push({ slug, date, ...values });
  }
  if (rows.length === 0 && errors.length === 0) errors.push("No data rows found.");
  return { rows, errors };
}
