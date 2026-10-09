import useSWR from "swr";
import type { MonthlyFlowPoint } from "@/lib/aum/industry-flows";

export interface IndustryMonthlyFlowsResponse {
  points: MonthlyFlowPoint[];
}

async function fetcher(url: string): Promise<IndustryMonthlyFlowsResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// No refreshInterval: industry-wide AMFI data updated at most once a month
// (manually, via the Admin form), nothing new to fetch within a session.
export function useIndustryMonthlyFlows() {
  return useSWR<IndustryMonthlyFlowsResponse>("/api/industry-monthly-flows", fetcher, {
    revalidateOnFocus: false,
  });
}
