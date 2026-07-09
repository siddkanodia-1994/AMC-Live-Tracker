"use client";

import { useSyncExternalStore } from "react";
import { formatRelativeTime } from "@/lib/utils/format";

function subscribe(callback: () => void) {
  const id = setInterval(callback, 1000);
  return () => clearInterval(id);
}

/**
 * Hydration-safe "Xs ago" text. Rendering formatRelativeTime directly during
 * SSR bakes the server's wall-clock into the HTML; by the time a slow
 * production load hydrates, the client recomputes different text and React
 * throws hydration error #418, discarding and re-rendering the whole page
 * (visible as a blank flash). Same deterministic-server-snapshot pattern as
 * LiveClockBadge/MarketStatusBadge — the placeholder is what's hydrated, and
 * the real (ticking) value swaps in immediately after mount.
 */
export function RelativeTime({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => formatRelativeTime(iso),
    () => "…"
  );
  return <>{text}</>;
}
