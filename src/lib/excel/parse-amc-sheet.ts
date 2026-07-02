import type { WorkBook } from "xlsx";
import { utils } from "xlsx";
import { assertHeaderRowAt } from "./find-header-row";
import { ISIN_FORMAT, isDebtInstrument } from "./instrument-classification";
import type { ParsedAmcSheet, ParsedHolding } from "./types";

const EQUITY_AUM_HEADER_ROW_INDEX = 2; // row 3 (1-based)
const HEADER_ROW_INDEX = 7; // row 8 (1-based)
const DATA_START_INDEX = 8; // row 9 (1-based)

const COL = {
  companyName: 0,
  sector: 1,
  mcapClassification: 2,
  isin: 3,
  marketValueCr: 4,
  shares: 5,
  weightPct: 6,
  prevMarketValueCr: 7,
  prevShares: 8,
  prevWeightPct: 9,
  // Columns 13, 16 are blank spacers; 14/15/17/18 hold independent, unequal-length
  // side-lists (New Entry / Complete Exit / Addition / Deletion) that can run past
  // the holdings block — never used for parsing or the block-termination check.
} as const;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (value == null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeMcap(value: unknown): string | null {
  if (value === 0 || value === "0") return null;
  if (value == null || String(value).trim() === "") return null;
  return String(value).trim();
}

function normalizeIsin(value: unknown): string | null {
  if (value === 0 || value === "0") return null;
  if (value == null || String(value).trim() === "") return null;
  return String(value).trim();
}

interface RawRow {
  companyName: string;
  sector: string;
  mcapClassification: string | null;
  isin: string | null;
  marketValueCr: number;
  shares: number;
  weightPct: number;
  prevMarketValueCr: number;
  prevShares: number;
  prevWeightPct: number;
}

export function parseAmcSheet(wb: WorkBook, sheetName: string): ParsedAmcSheet {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`[${sheetName}] Sheet not found in workbook`);

  const rows = utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });

  assertHeaderRowAt(
    rows,
    ["Company Name", "Sector", "ISIN Number"],
    HEADER_ROW_INDEX,
    12,
    sheetName
  );

  const warnings: string[] = [];

  // Optional cross-check value, not used in the residual-plug calculation itself
  // (Overview is the canonical source per the confirmed business rule).
  let equityAumHeaderCr: number | null = null;
  const aumHeaderRow = rows[EQUITY_AUM_HEADER_ROW_INDEX] ?? [];
  const aumHeaderLabel = String(aumHeaderRow[0] ?? "");
  if (/AUM/i.test(aumHeaderLabel)) {
    equityAumHeaderCr = toNumber(aumHeaderRow[4]);
  } else {
    warnings.push(
      `Could not find the equity-AUM cross-check header at row ${
        EQUITY_AUM_HEADER_ROW_INDEX + 1
      } (found "${aumHeaderLabel}") — skipping cross-check for this AMC.`
    );
  }

  const rawRows: RawRow[] = [];
  let foreignHoldingCount = 0;
  for (let i = DATA_START_INDEX; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const companyName = row[COL.companyName];
    if (companyName == null || String(companyName).trim() === "") break;

    const isin = normalizeIsin(row[COL.isin]);
    let finalIsin = isin;
    if (isin !== null) {
      if (!ISIN_FORMAT.test(isin)) {
        warnings.push(
          `Row ${i + 1}: ISIN "${isin}" for "${companyName}" is not a valid ISIN format — treating as non-priceable.`
        );
        finalIsin = null;
      } else if (!isin.startsWith("IN")) {
        // A legitimate foreign holding (global/feeder fund sleeve, e.g. US/TW/JP
        // listed stocks) — not a data error, just not priceable via DHAN (Indian
        // exchanges only). Keep the ISIN for display; just don't warn per-row.
        foreignHoldingCount++;
      }
    }

    rawRows.push({
      companyName: String(companyName).trim(),
      sector: String(row[COL.sector] ?? "").trim(),
      mcapClassification: normalizeMcap(row[COL.mcapClassification]),
      isin: finalIsin,
      marketValueCr: toNumber(row[COL.marketValueCr]),
      shares: toNumber(row[COL.shares]),
      weightPct: toNumber(row[COL.weightPct]),
      prevMarketValueCr: toNumber(row[COL.prevMarketValueCr]),
      prevShares: toNumber(row[COL.prevShares]),
      prevWeightPct: toNumber(row[COL.prevWeightPct]),
    });
  }

  if (foreignHoldingCount > 0) {
    warnings.push(
      `${foreignHoldingCount} foreign-listed holding(s) (non-"IN" ISIN) found — not priceable via DHAN, reported value will be used for these.`
    );
  }

  // Aggregate rows sharing a non-null ISIN (duplicates happen, including dirty
  // data — e.g. two companies erroneously carrying the same ISIN). Rows with a
  // null ISIN (G-Sec-adjacent "Others"/"Miscellaneous" rows, derivative overlays,
  // Net Current Asset) have no natural merge key and are kept individually.
  const byIsin = new Map<string, RawRow[]>();
  const unmergeable: RawRow[] = [];
  for (const row of rawRows) {
    if (row.isin === null) {
      unmergeable.push(row);
      continue;
    }
    const group = byIsin.get(row.isin) ?? [];
    group.push(row);
    byIsin.set(row.isin, group);
  }

  const holdings: ParsedHolding[] = [];

  for (const [isin, group] of byIsin) {
    if (group.length > 1) {
      warnings.push(
        `Duplicate ISIN ${isin} aggregated across ${group.length} rows: ${group
          .map((r) => r.companyName)
          .join(", ")}`
      );
    }
    const first = group[0];
    const marketValueCr = group.reduce((sum, r) => sum + r.marketValueCr, 0);
    const shares = group.reduce((sum, r) => sum + r.shares, 0);
    const weightPct = group.reduce((sum, r) => sum + r.weightPct, 0);
    const prevMarketValueCr = group.reduce((sum, r) => sum + r.prevMarketValueCr, 0);
    const prevShares = group.reduce((sum, r) => sum + r.prevShares, 0);
    const prevWeightPct = group.reduce((sum, r) => sum + r.prevWeightPct, 0);

    holdings.push({
      companyName: group.length > 1 ? group.map((r) => r.companyName).join(" / ") : first.companyName,
      sector: first.sector,
      mcapClassification: first.mcapClassification,
      isin,
      isPriceable:
        !isDebtInstrument(first.sector, first.companyName) &&
        isin.startsWith("IN") &&
        !isin.startsWith("INF"), // mutual fund unit ISINs, not equities
      marketValueCr,
      shares,
      weightPct,
      prevMarketValueCr,
      prevShares,
      prevWeightPct,
      changeMarketValueCr: marketValueCr - prevMarketValueCr,
      changeShares: shares - prevShares,
      changeWeightPct: weightPct - prevWeightPct,
    });
  }

  for (const row of unmergeable) {
    holdings.push({
      companyName: row.companyName,
      sector: row.sector,
      mcapClassification: row.mcapClassification,
      isin: null,
      isPriceable: false,
      marketValueCr: row.marketValueCr,
      shares: row.shares,
      weightPct: row.weightPct,
      prevMarketValueCr: row.prevMarketValueCr,
      prevShares: row.prevShares,
      prevWeightPct: row.prevWeightPct,
      changeMarketValueCr: row.marketValueCr - row.prevMarketValueCr,
      changeShares: row.shares - row.prevShares,
      changeWeightPct: row.weightPct - row.prevWeightPct,
    });
  }

  if (holdings.length === 0) {
    warnings.push(`No holdings parsed for this sheet — the residual plug will equal 100% of reported AUM.`);
  }

  const sheetTotalHoldingsValueCr = holdings.reduce((sum, h) => sum + h.marketValueCr, 0);

  return {
    sheetName,
    equityAumHeaderCr,
    holdings,
    sheetTotalHoldingsValueCr,
    warnings,
  };
}
