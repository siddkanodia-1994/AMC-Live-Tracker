import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { amcListedStock, amcs } from "../db/schema";
import {
  getAmcListedStockPriceHistoryForIsins,
  getAumHistoryForAmcIds,
  type AmcStockPricePoint,
  type AumHistoryPoint,
} from "../aum/history";
import { getStockCorrelationDefaults, type StockCorrelationDefaults } from "./correlation-defaults";

export interface AmcStockCorrelationEntry {
  slug: string;
  overviewName: string;
  tradingSymbol: string;
  aumHistory: AumHistoryPoint[];
  stockPriceSeries: AmcStockPricePoint[];
}

export interface AmcStockCorrelationData {
  amcs: AmcStockCorrelationEntry[];
  defaults: StockCorrelationDefaults;
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
export async function getAmcStockCorrelationData(): Promise<AmcStockCorrelationData> {
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

  const defaults = await getStockCorrelationDefaults();
  if (mappings.length === 0) return { amcs: [], defaults };

  const amcIds = mappings.map((m) => m.amcId);
  const isins = mappings.map((m) => m.isin);
  const priceFromDates = new Map(mappings.map((m) => [m.isin, m.backfillFromDate]));

  // No floor on the AUM side: backfillFromDate's purpose is "this AMC's own
  // stock has no price before this date" (still correctly applied below,
  // to the price query) -- AUM availability isn't gated by the AMC's own
  // listing date at all (confirmed: computeHistoricalAumEstimates never
  // reads backfillFromDate; it only truncates to the AMC's own real price
  // history, a separate mechanism). Discovered 2026-10 that applying this
  // floor to real liveAumDailySnapshot rows too was a no-op for 7 of 8
  // AMCs (their own backfillFromDate already predates real data's uniform
  // 2026-01-01 start) but silently hid 7 months of real AUM data for SBI
  // Mutual Fund specifically (backfillFromDate 2026-07-21, after real data
  // starts) -- which then made trimToLastContinuousRun discard everything
  // before that gap, including the newly-backfilled Jan-Dec 2025 estimate.
  const [aumByAmcId, priceByIsin] = await Promise.all([
    getAumHistoryForAmcIds(amcIds),
    getAmcListedStockPriceHistoryForIsins(isins, priceFromDates),
  ]);

  return {
    amcs: mappings.map((m) => ({
      slug: m.slug,
      overviewName: m.overviewName,
      tradingSymbol: m.tradingSymbol,
      aumHistory: aumByAmcId.get(m.amcId) ?? [],
      stockPriceSeries: priceByIsin.get(m.isin) ?? [],
    })),
    defaults,
  };
}
