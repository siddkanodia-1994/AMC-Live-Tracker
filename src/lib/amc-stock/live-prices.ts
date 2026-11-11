import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { amcListedStock, amcs, isinDailyPrice } from "../db/schema";
import { getIstDateString } from "../utils/date";
import { isMarketOpen, isTradingDay } from "../utils/market-hours";
import type { AmcLivePricesResponse } from "./live-point";

// Today's share price for the 8 listed AMCs, read from the row the live
// AUM computation already upserts into isin_daily_price on every run
// (compute-live-aum.ts) -- so this makes no DHAN call of its own and can
// never compete with the live AUM feed for DHAN's rate limit. At most 8
// rows; cached briefly so many viewers polling every 45s share one read.
const CACHE_TTL_MS = 30_000;
let cache: { result: AmcLivePricesResponse; expiresAt: number } | null = null;

export async function getAmcLivePrices(): Promise<AmcLivePricesResponse> {
  const today = getIstDateString();
  if (cache && cache.result.date === today && Date.now() < cache.expiresAt) {
    return { ...cache.result, marketOpen: isMarketOpen() };
  }

  const rows = isTradingDay()
    ? await db
        .select({
          slug: amcs.slug,
          tradingSymbol: amcListedStock.tradingSymbol,
          priceInr: isinDailyPrice.priceInr,
          computedAt: isinDailyPrice.computedAt,
        })
        .from(amcListedStock)
        .innerJoin(amcs, eq(amcListedStock.amcId, amcs.id))
        .innerJoin(isinDailyPrice, and(eq(isinDailyPrice.isin, amcListedStock.isin), eq(isinDailyPrice.snapshotDate, today)))
    : [];

  const result: AmcLivePricesResponse = {
    date: today,
    marketOpen: isMarketOpen(),
    prices: rows.flatMap((r) => {
      const priceInr = Number(r.priceInr);
      return Number.isFinite(priceInr) && priceInr > 0
        ? [{ slug: r.slug, tradingSymbol: r.tradingSymbol, priceInr, computedAt: r.computedAt.toISOString() }]
        : [];
    }),
  };
  cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
}
