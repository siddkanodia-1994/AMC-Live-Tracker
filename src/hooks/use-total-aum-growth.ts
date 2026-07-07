import useSWR from "swr";
import type { TotalAumGrowthResult } from "@/lib/aum/total-aum-growth";

async function fetcher(url: string): Promise<TotalAumGrowthResult> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// No refreshInterval: Reported/Income-Debt/Other AUM only change on import;
// Live AUM only changes once a day via the snapshot cron -- not worth polling.
export function useTotalAumGrowth(asOfDate?: string) {
  const qs = asOfDate ? `?asOfDate=${asOfDate}` : "";
  return useSWR<TotalAumGrowthResult>(`/api/total-aum-growth${qs}`, fetcher, {
    revalidateOnFocus: false,
  });
}
