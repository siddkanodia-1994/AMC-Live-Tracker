import useSWR from "swr";

export interface NetFlowOverridesResponse {
  reportPeriod: string;
  listedStockAmcIds: number[];
  overrides: Record<number, { netFlowOverrideCr: number; updatedAt: string }>;
}

async function fetcher(url: string): Promise<NetFlowOverridesResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// reportPeriod undefined -> no fetch yet (the Equity AUM Growth tab doesn't
// know the latest period until its own useAumGrowth call resolves).
export function useNetFlowOverrides(reportPeriod: string | undefined) {
  return useSWR<NetFlowOverridesResponse>(
    reportPeriod ? `/api/net-flow-override?reportPeriod=${encodeURIComponent(reportPeriod)}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );
}
