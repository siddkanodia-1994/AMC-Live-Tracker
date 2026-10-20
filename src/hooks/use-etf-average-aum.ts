import useSWR from "swr";
import type { EtfAverageAumSummary } from "@/lib/etf/average-aum";

async function fetcher(url: string): Promise<EtfAverageAumSummary> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// No refreshInterval: the underlying daily series only gains a new day once
// a day (same cadence as useEtfLiveAum's own NAV data), so there's nothing
// new to fetch between page loads within the same day.
export function useEtfAverageAum() {
  return useSWR<EtfAverageAumSummary>("/api/etf-average-aum", fetcher, {
    revalidateOnFocus: false,
  });
}
