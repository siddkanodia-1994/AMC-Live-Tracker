import useSWR from "swr";
import type { EtfDataBounds, EtfWindowComparisonRow } from "@/lib/etf/window-comparison";

export interface EtfWindowComparisonResponse {
  dataBounds: EtfDataBounds;
  rows: EtfWindowComparisonRow[];
}

async function fetcher(url: string): Promise<EtfWindowComparisonResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// Same URLSearchParams + useSWR convention as useOverviewAdjustments
// (src/hooks/use-overview-adjustments.ts) -- only set params that are
// present, omit entirely otherwise (dataBounds alone still comes back so
// the quarter dropdowns can populate before a window pair is chosen).
export function useEtfWindowComparison(
  w1Start?: string,
  w1End?: string,
  w2Start?: string,
  w2End?: string
) {
  const params = new URLSearchParams();
  if (w1Start) params.set("w1Start", w1Start);
  if (w1End) params.set("w1End", w1End);
  if (w2Start) params.set("w2Start", w2Start);
  if (w2End) params.set("w2End", w2End);
  const qs = params.toString();
  return useSWR<EtfWindowComparisonResponse>(`/api/etf-window-comparison${qs ? `?${qs}` : ""}`, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
}
