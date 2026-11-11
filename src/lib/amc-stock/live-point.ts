import type { AmcStockCorrelationEntry } from "./correlation-summary";
import type { AmcStockPricePoint } from "../aum/history";
import type { LiveAumSnapshot } from "../aum/types";

// Client-safe: the live share price feed's shape, and the overlay that puts
// today's live price (and today's live AUM) on an AMC's histories so every
// chart, ratio, fit, target and upside built from them moves with the market.

export interface AmcLivePrice {
  slug: string;
  tradingSymbol: string;
  priceInr: number;
  computedAt: string;
}

export interface AmcLivePricesResponse {
  /** Today's IST date; prices are for this date only. */
  date: string;
  marketOpen: boolean;
  prices: AmcLivePrice[];
}

export interface LivePoint {
  date: string;
  priceInr: number;
  /** Today's live AUM, same Gold/Silver blend as the history; null leaves today's AUM as loaded. */
  liveAumCr: number | null;
}

/** Today's live point per AMC slug: the live price, plus live AUM when the snapshot is today's. */
export function livePointsBySlug(prices: AmcLivePricesResponse | undefined, liveAum: LiveAumSnapshot | undefined): Map<string, LivePoint> {
  const out = new Map<string, LivePoint>();
  if (!prices) return out;
  const aumIsToday = liveAum ? istDate(liveAum.computedAt) === prices.date : false;
  for (const p of prices.prices) {
    const live = aumIsToday ? liveAum?.amcs.find((a) => a.slug === p.slug) : undefined;
    out.set(p.slug, { date: prices.date, priceInr: p.priceInr, liveAumCr: live && live.liveAumCr > 0 ? live.liveAumCr : null });
  }
  return out;
}

function istDate(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** The entry with today's price (and AUM) replaced by the live point, or appended when the history stops before today. */
export function withLivePoint(entry: AmcStockCorrelationEntry, point: LivePoint | undefined): AmcStockCorrelationEntry {
  if (!point) return entry;
  const prices = entry.stockPriceSeries;
  const lastPriceDate = prices.at(-1)?.date;
  if (lastPriceDate !== undefined && lastPriceDate > point.date) return entry;
  const stockPriceSeries = [...prices.filter((p) => p.date !== point.date), { date: point.date, priceInr: point.priceInr }];

  let aumHistory = entry.aumHistory;
  const lastAum = aumHistory.at(-1);
  if (point.liveAumCr !== null && lastAum) {
    if (lastAum.date === point.date) {
      aumHistory = [...aumHistory.slice(0, -1), { ...lastAum, liveAumCr: point.liveAumCr }];
    } else if (lastAum.date < point.date) {
      aumHistory = [...aumHistory, { ...lastAum, date: point.date, liveAumCr: point.liveAumCr }];
    }
  }
  return { ...entry, stockPriceSeries, aumHistory };
}

/** The last close before `date` (the day change's base). */
export function previousClose(series: AmcStockPricePoint[], date: string): number | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i].date < date) return series[i].priceInr;
  return null;
}
