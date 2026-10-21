import useSWR from "swr";
import { POLL_INTERVAL_MS } from "@/lib/utils/constants";
import type { LiveAumSnapshot } from "@/lib/aum/types";
import { useActiveGoldSilverBlendAmcIds } from "@/components/layout/gold-silver-blend-context";

async function fetcher(url: string): Promise<LiveAumSnapshot> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

export function useLiveAum(initialData?: LiveAumSnapshot, asOfDate?: string) {
  const historical = Boolean(asOfDate);
  const blendGoldSilverAmcIds = useActiveGoldSilverBlendAmcIds();
  const params = new URLSearchParams();
  if (historical) params.set("asOfDate", asOfDate!);
  // Historical (asOfDate) mode reconstructs a past day's own data from
  // scratch in overview-as-of.ts -- a separate code path this blend hasn't
  // been extended to, so the param is only sent in live mode.
  if (!historical && blendGoldSilverAmcIds.length > 0) params.set("blendGoldSilverAmcIds", blendGoldSilverAmcIds.join(","));
  const qs = params.toString();
  return useSWR<LiveAumSnapshot>(qs ? `/api/live-aum?${qs}` : "/api/live-aum", fetcher, {
    // Historical snapshots never change, so don't poll or revalidate them --
    // and don't seed them with the live-mode server-rendered fallback, which
    // is a different date's data.
    refreshInterval: historical ? 0 : POLL_INTERVAL_MS,
    revalidateOnFocus: !historical,
    fallbackData: historical ? undefined : initialData,
  });
}
