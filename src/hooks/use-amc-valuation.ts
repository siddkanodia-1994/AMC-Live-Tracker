import useSWR from "swr";
import type { AmcValuationSeries } from "@/lib/valuation/store";

async function fetcher(url: string): Promise<AmcValuationSeries> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

// Changes when someone uploads a new file (the upload panel calls mutate on
// this key afterwards) and once a day as new closes extend the price-scaled
// tail -- so no polling and no focus revalidation.
export function useAmcValuation(slug: string | null) {
  return useSWR<AmcValuationSeries>(slug ? `/api/amc-valuation?slug=${encodeURIComponent(slug)}` : null, fetcher, {
    revalidateOnFocus: false,
  });
}
