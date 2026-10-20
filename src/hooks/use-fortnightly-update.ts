import useSWR from "swr";
import type { EligibleAmc, FortnightlySheet } from "@/lib/aum/fortnightly-update";
import { useActiveGoldSilverBlendAmcIds } from "@/components/layout/gold-silver-blend-context";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function useFortnightlyEligibleAmcs() {
  return useSWR<{ amcs: EligibleAmc[] }>("/api/fortnightly-update/amcs", fetcher, { revalidateOnFocus: false });
}

export function useFortnightlySheet(amcId: number | null, asOfDate: string | null, includeFlowEstimate: boolean) {
  const blendGoldSilverAmcIds = useActiveGoldSilverBlendAmcIds();
  const params = new URLSearchParams();
  if (amcId !== null) params.set("amcId", String(amcId));
  if (asOfDate) params.set("asOfDate", asOfDate);
  if (includeFlowEstimate) params.set("includeFlowEstimate", "true");
  if (amcId !== null && blendGoldSilverAmcIds.includes(amcId)) params.set("blendGoldSilver", "true");
  return useSWR<FortnightlySheet>(
    amcId !== null ? `/api/fortnightly-update?${params.toString()}` : null,
    fetcher,
    // keepPreviousData: toggling includeFlowEstimate changes this key, and
    // without it `data` would briefly go undefined -- tripping the panel's
    // "no data yet" skeleton guard, which unmounts (and resets) sibling
    // components like the download panel's own selection state.
    { revalidateOnFocus: false, keepPreviousData: true }
  );
}
