import useSWR from "swr";
import type { EtfLiveAum } from "@/lib/etf/compute-live-aum";

export interface EtfLiveAumResponse {
  schemes: EtfLiveAum[];
  computedAt: string;
}

async function fetcher(url: string): Promise<EtfLiveAumResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// No refreshInterval: unlike equity, this isn't a 45s-poll live feed -- NAV
// only updates once a day via the cron, so there's nothing new to fetch
// between page loads within the same day.
export function useEtfLiveAum() {
  return useSWR<EtfLiveAumResponse>("/api/etf-live-aum", fetcher, {
    revalidateOnFocus: false,
  });
}
