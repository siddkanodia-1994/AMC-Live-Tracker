import useSWR from "swr";
import type { SectoralHoldingsResult } from "@/lib/aum/sectoral-holdings";

async function fetcher(url: string): Promise<SectoralHoldingsResult> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// No refreshInterval: holdings only change on an explicit admin upload,
// not intraday -- same pattern as use-cash-holdings.ts. `period` is part
// of the SWR key so switching months never reuses another month's cache.
export function useSectoralHoldings(period?: string) {
  const url = period ? `/api/sectoral-holdings?period=${encodeURIComponent(period)}` : "/api/sectoral-holdings";
  return useSWR<SectoralHoldingsResult>(url, fetcher, {
    revalidateOnFocus: false,
  });
}
