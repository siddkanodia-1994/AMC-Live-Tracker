"use client";

import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { isMarketOpen } from "@/lib/utils/market-hours";
import { getIstTimeString } from "@/lib/utils/date";

const PLACEHOLDER_TIME = "--:--:--";

function subscribe(callback: () => void) {
  const id = setInterval(callback, 1000);
  return () => clearInterval(id);
}

function getServerSnapshot(): string {
  // Deterministic SSR placeholder, same reasoning as MarketStatusBadge --
  // useSyncExternalStore reconciles to the real ticking IST time immediately
  // after mount, avoiding a hand-rolled mounted-state effect.
  return PLACEHOLDER_TIME;
}

export function LiveClockBadge() {
  const time = useSyncExternalStore(subscribe, getIstTimeString, getServerSnapshot);
  const open = time !== PLACEHOLDER_TIME && isMarketOpen();

  return (
    <Badge
      variant="outline"
      className={
        open
          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground"
      }
    >
      <span
        className={`mr-1.5 inline-block size-1.5 rounded-full ${
          open ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"
        }`}
      />
      <span className="font-semibold">{open ? "LIVE" : "CLOSED"}</span>
      <span className="ml-1.5 font-mono tabular-nums">{time}</span>
    </Badge>
  );
}
