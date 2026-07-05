import useSWR from "swr";
import type { CashHoldingsResult } from "@/lib/aum/cash-holdings";

async function fetcher(url: string): Promise<CashHoldingsResult> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// No refreshInterval: cash/repo/debt line items are never DHAN-priced, so
// this figure is stable intraday — no benefit to polling every 45s.
export function useCashHoldings() {
  return useSWR<CashHoldingsResult>("/api/cash-holdings", fetcher, {
    revalidateOnFocus: false,
  });
}
