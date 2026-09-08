import useSWR from "swr";
import type { McxReferenceRow } from "@/lib/mcx/compute";

export interface McxReferenceResponse {
  rows: McxReferenceRow[];
  computedAt: string;
}

async function fetcher(url: string): Promise<McxReferenceResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// No refreshInterval, same rationale as use-etf-live-aum.ts: MCX prices
// only update once a day via the cron.
export function useMcxReference() {
  return useSWR<McxReferenceResponse>("/api/mcx-reference", fetcher, {
    revalidateOnFocus: false,
  });
}
