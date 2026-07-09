import useSWR from "swr";
import { POLL_INTERVAL_MS } from "@/lib/utils/constants";
import type { LiveAumSnapshot } from "@/lib/aum/types";

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
  return useSWR<LiveAumSnapshot>(historical ? `/api/live-aum?asOfDate=${asOfDate}` : "/api/live-aum", fetcher, {
    // Historical snapshots never change, so don't poll or revalidate them --
    // and don't seed them with the live-mode server-rendered fallback, which
    // is a different date's data.
    refreshInterval: historical ? 0 : POLL_INTERVAL_MS,
    revalidateOnFocus: !historical,
    fallbackData: historical ? undefined : initialData,
  });
}
