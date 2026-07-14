import useSWR from "swr";
import type { DailyDataQualityRow } from "@/lib/aum/daily-data-quality";

interface DailyDataQualityResponse {
  rows: DailyDataQualityRow[];
}

async function fetcher(url: string): Promise<DailyDataQualityResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// No refreshInterval: this only changes once/day (the 4:05 PM cron), no
// benefit to polling every 45s like the live-AUM data.
export function useDailyDataQuality() {
  return useSWR<DailyDataQualityResponse>("/api/daily-data-quality", fetcher, {
    revalidateOnFocus: false,
  });
}
