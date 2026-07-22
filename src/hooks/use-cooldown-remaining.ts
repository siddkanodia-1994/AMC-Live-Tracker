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
    // Rounded to whole seconds -- same reason formatRelativeTime rounds
    // (format.ts) before RelativeTime returns it: useSyncExternalStore
    // requires getSnapshot to return a STABLE value between calls unless
    // the store actually changed. Raw milliseconds change on essentially
    // every call (real time keeps advancing between React's render call
    // and its immediate re-check), so React perpetually sees "a change",
    // reschedules, and re-renders forever -- "Maximum update depth
    // exceeded" (React error #185). Rounding to seconds -- the same
    // granularity subscribe's 1s tick already uses -- makes repeated calls
    // within the same second return the identical number.
    () => Math.max(0, Math.ceil((new Date(sinceIso).getTime() + ttlMs - Date.now()) / 1000)) * 1000,
    () => ttlMs
  );
}
