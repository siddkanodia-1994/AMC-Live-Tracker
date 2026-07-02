"use client";

import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { isMarketOpen } from "@/lib/utils/market-hours";

function subscribe(callback: () => void) {
  const id = setInterval(callback, 30_000);
  return () => clearInterval(id);
}

function getSnapshot(): boolean {
  return isMarketOpen();
}

function getServerSnapshot(): boolean {
  // Deterministic SSR default; useSyncExternalStore reconciles against the
  // real client value immediately after mount, avoiding a hand-rolled
  // mounted-state effect for what's fundamentally an external (time-based) store.
  return false;
}

export function MarketStatusBadge() {
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <Badge
      variant="outline"
      className={
        open
          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground"
      }
    >
      <span className={`mr-1.5 inline-block size-1.5 rounded-full ${open ? "bg-emerald-500" : "bg-muted-foreground"}`} />
      {open ? "Live" : "Closed"}
    </Badge>
  );
}
