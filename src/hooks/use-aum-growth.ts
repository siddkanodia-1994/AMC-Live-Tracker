import useSWR from "swr";
import type { AumGrowthRow } from "@/lib/aum/aum-growth";

export interface AumGrowthResponse {
  periods: string[];
  periodA: string | null;
  periodB: string | null;
  rows: AumGrowthRow[];
}

async function fetcher(url: string): Promise<AumGrowthResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// No refreshInterval: this compares two already-imported periods' data, not
// anything live -- it only changes when a new period is imported.
export function useAumGrowth(periodA?: string, periodB?: string) {
  const params = new URLSearchParams();
  if (periodA) params.set("periodA", periodA);
  if (periodB) params.set("periodB", periodB);
  const qs = params.toString();

  return useSWR<AumGrowthResponse>(`/api/aum-growth${qs ? `?${qs}` : ""}`, fetcher, {
    revalidateOnFocus: false,
  });
}
