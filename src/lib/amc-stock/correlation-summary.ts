import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { amcListedStock, amcs } from "../db/schema";
import {
  getAmcListedStockPriceHistoryForIsins,
  getAumHistoryForAmcIds,
  type AmcStockPricePoint,
  type AumHistoryPoint,
} from "../aum/history";

export interface AmcStockCorrelationEntry {
  slug: string;
  overviewName: string;
  tradingSymbol: string;
  aumHistory: AumHistoryPoint[];
  stockPriceSeries: AmcStockPricePoint[];
}

/**
 * Raw per-AMC history for every AMC with a listed stock -- one batched AUM
 * query and one batched price query (see getAumHistoryForAmcIds /
 * getAmcListedStockPriceHistoryForIsins) instead of 8+8 round trips.
 * Deliberately returns RAW daily data with no moving-average/correlation
 * math applied: the Stock Correlation tab (like the AUM Trend chart's own
 * share-price toggle) recomputes that client-side from a single shared
 * input, so there's nothing to recompute server-side per keystroke.
 */
export async function getAmcStockCorrelationData(): Promise<AmcStockCorrelationEntry[]> {
  const mappings = await db
    .select({
      amcId: amcListedStock.amcId,
      isin: amcListedStock.isin,
      tradingSymbol: amcListedStock.tradingSymbol,
      backfillFromDate: amcListedStock.backfillFromDate,
      slug: amcs.slug,
      overviewName: amcs.overviewName,
    })
    .from(amcListedStock)
    .innerJoin(amcs, eq(amcListedStock.amcId, amcs.id));

  if (mappings.length === 0) return [];

  const amcIds = mappings.map((m) => m.amcId);
  const isins = mappings.map((m) => m.isin);
  const aumFromDates = new Map(mappings.map((m) => [m.amcId, m.backfillFromDate]));
  const priceFromDates = new Map(mappings.map((m) => [m.isin, m.backfillFromDate]));

  const [aumByAmcId, priceByIsin] = await Promise.all([
    getAumHistoryForAmcIds(amcIds, aumFromDates),
    getAmcListedStockPriceHistoryForIsins(isins, priceFromDates),
  ]);

  return mappings.map((m) => ({
    slug: m.slug,
    overviewName: m.overviewName,
    tradingSymbol: m.tradingSymbol,
    aumHistory: aumByAmcId.get(m.amcId) ?? [],
    stockPriceSeries: priceByIsin.get(m.isin) ?? [],
  }));
}
