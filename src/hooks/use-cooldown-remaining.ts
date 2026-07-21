"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  const id = setInterval(callback, 1000);
  return () => clearInterval(id);
}

/**
 * Milliseconds remaining before a manual refresh can trigger a genuinely new
 * computation -- mirrors the server's own LIVE_AUM_CACHE_TTL_MS cache TTL so
 * the button's countdown always matches when the server-side cache will
 * actually expire, no separate client-side timer state to drift out of sync.
 * Same hydration-safe useSyncExternalStore + 1s-tick pattern as RelativeTime
 * (components/ui/relative-time.tsx), inverted to count down instead of up.
 */
export function useCooldownRemainingMs(sinceIso: string, ttlMs: number): number {
  return useSyncExternalStore(
    subscribe,
    () => Math.max(0, new Date(sinceIso).getTime() + ttlMs - Date.now()),
    () => ttlMs
  );
}
