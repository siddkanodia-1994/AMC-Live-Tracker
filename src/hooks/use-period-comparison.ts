import useSWR from "swr";
import type { PeriodComparisonResult } from "@/lib/aum/period-comparison";

async function fetcher(url: string): Promise<PeriodComparisonResult | null> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// No refreshInterval: unlike live AUM, this is derived purely from imported
// holdings snapshots — it only changes when a new month's file is uploaded,
// not every 45s.
export function usePeriodComparison(slug: string) {
  return useSWR<PeriodComparisonResult | null>(`/api/amc/${slug}/period-comparison`, fetcher, {
    revalidateOnFocus: false,
  });
}
