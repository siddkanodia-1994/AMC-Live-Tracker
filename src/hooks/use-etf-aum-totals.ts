import useSWR from "swr";

export interface EtfAumTotalsResponse {
  totalsByAmc: Record<string, number>;
}

async function fetcher(url: string): Promise<EtfAumTotalsResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// No refreshInterval, same rationale as use-etf-live-aum.ts: this is AMFI's
// quarterly AAUM disclosure, updated once a day via the cron at most.
export function useEtfAumTotals() {
  return useSWR<EtfAumTotalsResponse>("/api/etf-aum-totals-by-amc", fetcher, {
    revalidateOnFocus: false,
  });
}
