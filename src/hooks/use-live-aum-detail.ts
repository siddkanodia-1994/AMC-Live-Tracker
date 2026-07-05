import useSWR from "swr";
import { POLL_INTERVAL_MS } from "@/lib/utils/constants";
import type { AmcLiveAum, HoldingLiveView } from "@/lib/aum/types";

export interface AmcDetailResponse {
  amc: AmcLiveAum;
  holdings: HoldingLiveView[];
  computedAt: string;
  priceAsOfDate: string;
  pricesAreLive: boolean;
}

async function fetcher(url: string): Promise<AmcDetailResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function useLiveAumDetail(slug: string, initialData?: AmcDetailResponse) {
  return useSWR<AmcDetailResponse>(`/api/live-aum/${slug}`, fetcher, {
    refreshInterval: POLL_INTERVAL_MS,
    revalidateOnFocus: true,
    fallbackData: initialData,
  });
}
