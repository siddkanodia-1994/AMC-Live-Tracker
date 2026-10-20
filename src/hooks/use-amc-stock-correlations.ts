import useSWR from "swr";
import type { AmcStockCorrelationEntry } from "@/lib/amc-stock/correlation-summary";
import type { StockCorrelationDefaults } from "@/lib/amc-stock/correlation-defaults";
import { useActiveGoldSilverBlendAmcIds } from "@/components/layout/gold-silver-blend-context";

export interface AmcStockCorrelationsResponse {
  amcs: AmcStockCorrelationEntry[];
  defaults: StockCorrelationDefaults;
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
  const blendGoldSilverAmcIds = useActiveGoldSilverBlendAmcIds();
  const qs = blendGoldSilverAmcIds.length > 0 ? `?blendGoldSilverAmcIds=${blendGoldSilverAmcIds.join(",")}` : "";
  return useSWR<AmcStockCorrelationsResponse>(`/api/amc-stock-correlations${qs}`, fetcher, {
    revalidateOnFocus: false,
  });
}
