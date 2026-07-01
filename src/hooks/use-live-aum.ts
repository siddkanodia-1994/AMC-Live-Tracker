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

export function useLiveAum(initialData?: LiveAumSnapshot) {
  return useSWR<LiveAumSnapshot>("/api/live-aum", fetcher, {
    refreshInterval: POLL_INTERVAL_MS,
    revalidateOnFocus: true,
    fallbackData: initialData,
  });
}
