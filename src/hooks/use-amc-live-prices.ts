import { useMemo } from "react";
import useSWR from "swr";
import { POLL_INTERVAL_MS } from "@/lib/utils/constants";
import { isMarketOpen } from "@/lib/utils/market-hours";
import { livePointsBySlug, withLivePoint, type AmcLivePricesResponse, type LivePoint } from "@/lib/amc-stock/live-point";
import type { AmcStockCorrelationEntry } from "@/lib/amc-stock/correlation-summary";
import type { LiveAumSnapshot } from "@/lib/aum/types";

async function fetcher(url: string): Promise<AmcLivePricesResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// Keeps polling a few minutes past 15:30 so the session's last traded
// price (the live computation's final write) replaces the intraday one.
const CLOSE_GRACE_MS = 5 * 60 * 1000;

function inSession(): boolean {
  const now = Date.now();
  return isMarketOpen(new Date(now)) || isMarketOpen(new Date(now - CLOSE_GRACE_MS));
}

// Module-level so its identity never changes: SWR restarts its poll timer
// whenever refreshInterval changes, and an inline arrow would reset it on
// every re-render (the live AUM poll re-renders this tab each minute).
const pollWhileInSession = () => (inSession() ? POLL_INTERVAL_MS : 0);

// The 8 listed AMCs' share price for today, every 45s while the market is
// open (same cadence as live AUM); outside the session it's read once.
export function useAmcLivePrices() {
  return useSWR<AmcLivePricesResponse>("/api/amc-live-prices", fetcher, {
    refreshInterval: pollWhileInSession,
    revalidateOnFocus: false,
  });
}

/** Entries with today's live price and AUM laid over their histories, plus each AMC's live point. */
export function useLiveCorrelationEntries(entries: AmcStockCorrelationEntry[] | undefined, liveAum: LiveAumSnapshot | undefined) {
  const { data: prices } = useAmcLivePrices();
  return useMemo(() => {
    const points: Map<string, LivePoint> = livePointsBySlug(prices, liveAum);
    return {
      prices,
      points,
      entries: entries?.map((e) => withLivePoint(e, points.get(e.slug))),
    };
  }, [entries, prices, liveAum]);
}
