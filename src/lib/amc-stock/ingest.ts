import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { amcListedStock, instrumentMap } from "../db/schema";
import { fetchHistoricalCloses } from "../dhan/historical-client";
import type { ExchangeSegment } from "../dhan/types";
import { writeIsinDailyPriceRows } from "../aum/isin-price-store";
import { getIstDateString } from "../utils/date";

export interface AmcStockIngestResult {
  mappingsTracked: number;
  rowsUpserted: number;
  warnings: string[];
}

/**
 * Daily ingestion for the AMC detail page's own listed-stock share-price
 * overlay (see amc-listed-stock seed + aum-trend-chart.tsx). Entirely
 * independent of the equity holdings pipeline -- these ISINs are never
 * anyone's holding, just the AMC's own stock -- and independent of the
 * ETF/MCX pipelines too, its own isolated cron step.
 *
 * Deliberately NOT built on backfillIsinPriceHistory (used by
 * stale-mapping-reclaim.ts): that helper hardcodes a "last N trading
 * days before today" window and unconditionally recomputes every AMC's
 * canonical AUM snapshot for each touched date (pure wasted work here,
 * since no holding references these ISINs). Calls the two underlying
 * primitives -- fetchHistoricalCloses + writeIsinDailyPriceRows --
 * directly instead, over each mapping's own [backfillFromDate, today]
 * window.
 *
 * Always re-fetches the WHOLE window, every run, same philosophy as
 * runMcxIngestion: DHAN's historical endpoint returns a full date range
 * in one call regardless of its length, so re-upserting already-correct
 * historical rows is cheap and self-heals any single missed/wrong day
 * automatically -- no separate one-time "backfill" vs. daily "update"
 * code path needed at all.
 */
export async function runAmcStockIngestion(): Promise<AmcStockIngestResult> {
  const mappings = await db.select().from(amcListedStock);
  const warnings: string[] = [];

  if (mappings.length === 0) {
    return { mappingsTracked: 0, rowsUpserted: 0, warnings: ["No AMC listed-stock mappings registered yet — run scripts/seed-amc-listed-stocks.ts."] };
  }

  const today = getIstDateString();
  let rowsUpserted = 0;

  for (const mapping of mappings) {
    const [instrument] = await db.select().from(instrumentMap).where(eq(instrumentMap.isin, mapping.isin));
    if (!instrument) {
      warnings.push(`[${mapping.tradingSymbol}] No instrument_map entry for ISIN ${mapping.isin} — run scripts/seed-amc-listed-stocks.ts.`);
      continue;
    }

    const closes = await fetchHistoricalCloses(
      instrument.securityId,
      instrument.exchangeSegment as ExchangeSegment,
      mapping.backfillFromDate,
      today
    );
    if (closes.length === 0) {
      warnings.push(`[${mapping.tradingSymbol}] No price data returned for ${mapping.backfillFromDate} to ${today}.`);
      continue;
    }

    await writeIsinDailyPriceRows(closes.map((c) => ({ isin: mapping.isin, snapshotDate: c.date, priceInr: c.close })));
    rowsUpserted += closes.length;
  }

  return { mappingsTracked: mappings.length, rowsUpserted, warnings };
}
