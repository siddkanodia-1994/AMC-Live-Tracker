import useSWR from "swr";
import type { HoldingLiveView } from "@/lib/aum/types";

export interface CompareAmcEntry {
  slug: string;
  overviewName: string;
  holdings: HoldingLiveView[];
}

interface CompareAmcsResponse {
  amcs: CompareAmcEntry[];
}

async function fetcher(url: string): Promise<CompareAmcsResponse> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// null key below (fewer than 2 slugs selected) tells SWR not to fetch at
// all -- same "conditional fetching" convention SWR itself documents, so the
// panel doesn't hit the API until there's actually something to compare.
export function useCompareAmcs(slugs: string[]) {
  const key = slugs.length >= 2 ? `/api/amc/compare?slugs=${slugs.join(",")}` : null;
  return useSWR<CompareAmcsResponse>(key, fetcher, {
    revalidateOnFocus: false,
  });
}
