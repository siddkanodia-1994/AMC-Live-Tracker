import { parse } from "csv-parse/sync";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import { holdings, instrumentMap } from "../db/schema";
import type { ExchangeSegment, RawInstrumentRow } from "./types";

const DHAN_INSTRUMENT_MASTER_URL = "https://images.dhan.co/api-data/api-scrip-master-detailed.csv";

/**
 * Downloads DHAN's detailed instrument master CSV and returns only cash-equity
 * rows on NSE/BSE with a real ISIN. Confirmed columns (verified against the
 * live file): EXCH_ID, SEGMENT ("E" for equity), SECURITY_ID, ISIN, INSTRUMENT
 * ("EQUITY"), SYMBOL_NAME. The same ISIN commonly appears on both NSE and BSE
 * with different SECURITY_IDs — callers should prefer NSE_EQ.
 */
export async function downloadInstrumentMaster(): Promise<RawInstrumentRow[]> {
  const res = await fetch(DHAN_INSTRUMENT_MASTER_URL);
  if (!res.ok) {
    throw new Error(`Failed to download DHAN instrument master: HTTP ${res.status}`);
  }
  const csvText = await res.text();

  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rows: RawInstrumentRow[] = [];
  for (const record of records) {
    const exchId = record.EXCH_ID;
    const segment = record.SEGMENT;
    const instrument = record.INSTRUMENT;
    const isin = record.ISIN;
    const securityId = record.SECURITY_ID;

    if (instrument !== "EQUITY" || segment !== "E") continue;
    if (exchId !== "NSE" && exchId !== "BSE") continue;
    if (!isin || isin === "NA" || !securityId) continue;

    rows.push({
      isin,
      securityId,
      exchangeSegment: `${exchId}_EQ` as ExchangeSegment,
      tradingSymbol: record.SYMBOL_NAME || null,
    });
  }

  return rows;
}

export interface SyncInstrumentMapResult {
  upserted: number;
  unmatchedIsins: string[];
}

/**
 * Refreshes instrument_map for every ISIN our holdings actually need priced.
 * Manually triggered (admin page / scripts/sync-instruments.ts) — no cron.
 */
export async function syncInstrumentMap(): Promise<SyncInstrumentMapResult> {
  const priceableIsinRows = await db
    .selectDistinct({ isin: holdings.isin })
    .from(holdings)
    .where(and(eq(holdings.isPriceable, true), isNotNull(holdings.isin)));

  const priceableIsins = new Set(priceableIsinRows.map((r) => r.isin).filter((v): v is string => v !== null));

  if (priceableIsins.size === 0) {
    return { upserted: 0, unmatchedIsins: [] };
  }

  const masterRows = await downloadInstrumentMaster();

  const byIsin = new Map<string, RawInstrumentRow>();
  for (const row of masterRows) {
    if (!priceableIsins.has(row.isin)) continue;
    const existing = byIsin.get(row.isin);
    if (!existing || (existing.exchangeSegment === "BSE_EQ" && row.exchangeSegment === "NSE_EQ")) {
      byIsin.set(row.isin, row);
    }
  }

  const rowsToUpsert = [...byIsin.values()];

  if (rowsToUpsert.length > 0) {
    await db
      .insert(instrumentMap)
      .values(
        rowsToUpsert.map((row) => ({
          isin: row.isin,
          securityId: row.securityId,
          exchangeSegment: row.exchangeSegment,
          tradingSymbol: row.tradingSymbol,
        }))
      )
      .onConflictDoUpdate({
        target: instrumentMap.isin,
        set: {
          securityId: sql`excluded.security_id`,
          exchangeSegment: sql`excluded.exchange_segment`,
          tradingSymbol: sql`excluded.trading_symbol`,
          updatedAt: new Date(),
        },
      });
  }

  const unmatchedIsins = [...priceableIsins].filter((isin) => !byIsin.has(isin));

  return { upserted: rowsToUpsert.length, unmatchedIsins };
}
