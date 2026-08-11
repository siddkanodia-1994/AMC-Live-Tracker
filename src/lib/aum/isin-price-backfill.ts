import { fetchHistoricalCloses } from "../dhan/historical-client";
import type { ExchangeSegment } from "../dhan/types";
import { getIstDateString } from "../utils/date";
import { invalidateLiveAumCache } from "./cache";
import { lastNTradingDatesBefore } from "./last-close-mute";
import { writeIsinDailyPriceRows } from "./isin-price-store";
import { recomputeCanonicalSnapshotsForDate } from "./outage-reclaim";

// Generous margin over the worst observed stuck streak so far (Inox
// Green Energy Services, ~8 trading days) -- over-fetching is harmless
// since DHAN just returns the same real close for a day that was
// already correct, so there's no downside to a wider window.
export const STALE_MAPPING_BACKFILL_LOOKBACK_DAYS = 20;

/**
 * Re-fetches one ISIN's genuine DHAN historical closes over the last
 * `lookbackTradingDays` real trading days and overwrites isin_daily_price
 * for every date returned, then recomputes each touched date's affected
 * AMCs' canonical live_aum_daily_snapshot rows -- corrects a stretch of
 * history that was silently wrong (e.g. frozen at a stale carry-forward
 * price because this ISIN's DHAN security ID was wrong until just now).
 * Distinct from outage-reclaim.ts's chunked correction, which only ever
 * targets whole-day, whole-universe outages -- this targets one ISIN's
 * own history directly, using whatever securityId/exchangeSegment is
 * correct right now.
 */
export async function backfillIsinPriceHistory(
  isin: string,
  securityId: string,
  exchangeSegment: ExchangeSegment,
  lookbackTradingDays: number
): Promise<{ datesUpdated: string[] }> {
  const tradingDates = lastNTradingDatesBefore(getIstDateString(), lookbackTradingDays);
  if (tradingDates.length === 0) return { datesUpdated: [] };

  const fromDate = tradingDates[tradingDates.length - 1];
  const toDateInclusive = tradingDates[0];

  const closes = await fetchHistoricalCloses(securityId, exchangeSegment, fromDate, toDateInclusive);
  if (closes.length === 0) return { datesUpdated: [] };

  await writeIsinDailyPriceRows(closes.map((c) => ({ isin, snapshotDate: c.date, priceInr: c.close })));

  const datesUpdated = closes.map((c) => c.date);
  for (const date of datesUpdated) {
    await recomputeCanonicalSnapshotsForDate(date);
  }
  invalidateLiveAumCache();

  return { datesUpdated };
}
