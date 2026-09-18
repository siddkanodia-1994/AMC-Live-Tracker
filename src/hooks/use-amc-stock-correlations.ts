import useSWR from "swr";
import type { AmcStockCorrelationEntry } from "@/lib/amc-stock/correlation-summary";

export interface AmcStockCorrelationsResponse {
  amcs: AmcStockCorrelationEntry[];
  computedAt: string;
}

async function fetcher(url: string): Promise<AmcStockCorrelationsResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// No refreshInterval: like the ETF tab, this is once-a-day cron-updated
// history, not a 45s-poll live feed -- nothing new to fetch within a day.
export function useAmcStockCorrelations() {
  return useSWR<AmcStockCorrelationsResponse>("/api/amc-stock-correlations", fetcher, {
    revalidateOnFocus: false,
  });
}
