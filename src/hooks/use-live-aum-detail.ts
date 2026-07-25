import useSWR from "swr";
import { POLL_INTERVAL_MS } from "@/lib/utils/constants";
import type { AmcLiveAum, HoldingLiveView } from "@/lib/aum/types";

export interface AmcDetailResponse {
  amc: AmcLiveAum;
  holdings: HoldingLiveView[];
  computedAt: string;
  priceAsOfDate: string;
  pricesAreLive: boolean;
  // Set on a historical (?asOfDate=) response -- null/undefined in live mode.
  // min/maxSnapshotDate bound the date picker, same convention /api/live-aum
  // already uses for the Overview page.
  asOfDate?: string | null;
  minSnapshotDate?: string | null;
  maxSnapshotDate?: string | null;
}

async function fetcher(url: string): Promise<AmcDetailResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function useLiveAumDetail(slug: string, initialData?: AmcDetailResponse, asOfDate?: string) {
  const historical = Boolean(asOfDate);
  return useSWR<AmcDetailResponse>(
    historical ? `/api/live-aum/${slug}?asOfDate=${asOfDate}` : `/api/live-aum/${slug}`,
    fetcher,
    {
      refreshInterval: historical ? 0 : POLL_INTERVAL_MS,
      revalidateOnFocus: !historical,
      fallbackData: historical ? undefined : initialData,
    }
  );
}
