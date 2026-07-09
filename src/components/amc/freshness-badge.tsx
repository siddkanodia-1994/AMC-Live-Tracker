"use client";

import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { POLL_INTERVAL_MS } from "@/lib/utils/constants";
import { formatShortDate } from "@/lib/utils/format";
import type { DhanStatus } from "@/lib/aum/types";

// A quote timestamp older than several missed polls means the browser has
// stopped refreshing (network drop, sleeping tab) — the numbers on screen
// are silently stale even though nothing errored.
const QUOTE_STALE_AFTER_MS = 4 * POLL_INTERVAL_MS;

// The daily snapshot cron writing nothing for this many days can't be
// explained by a weekend or a single holiday — history collection is dead.
const SNAPSHOT_STALE_AFTER_DAYS = 4;

function subscribe(callback: () => void) {
  const id = setInterval(callback, 1000);
  return () => clearInterval(id);
}

function istTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  });
}

/**
 * Compact always-visible freshness indicator for the Overview: green-ish
 * (default) with the exact IST time the shown prices were computed, amber
 * ONLY when the numbers genuinely can't be trusted as current — a DHAN
 * call-level failure (expired token, rate limit, network error, total
 * outage), stocks that were being priced live before but aren't anymore
 * (coverage regression), stalled polling, or a dead snapshot cron.
 * Deliberately NOT amber for dhanStatus "degraded" alone: that fires
 * perpetually for illiquid holdings DHAN simply never quotes, which is
 * benign. Hydration-safe via the same deterministic-server-snapshot pattern
 * as LiveClockBadge (time-derived text must not be baked into SSR HTML).
 */
export function FreshnessBadge({
  computedAt,
  pricesAreLive,
  priceAsOfDate,
  dhanStatus,
  dhanErrorDetail,
  distinctLastCloseCount,
  maxSnapshotDate,
}: {
  computedAt: string;
  pricesAreLive: boolean;
  priceAsOfDate: string;
  dhanStatus: DhanStatus;
  dhanErrorDetail: string | null;
  distinctLastCloseCount: number;
  maxSnapshotDate: string | null;
}) {
  const now = useSyncExternalStore(
    subscribe,
    () => Date.now(),
    () => 0
  );

  // SSR + hydration render: deterministic placeholder, reconciled on mount.
  if (now === 0) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Prices as of --:--:-- IST
      </Badge>
    );
  }

  const quoteAgeMs = now - new Date(computedAt).getTime();
  const snapshotAgeDays = maxSnapshotDate
    ? Math.floor((now - new Date(`${maxSnapshotDate}T00:00:00Z`).getTime()) / 86_400_000)
    : null;

  let warning: string | null = null;
  if (dhanStatus === "unavailable") {
    warning = "DHAN pricing unavailable — showing last known values";
  } else if (dhanErrorDetail !== null) {
    warning = `DHAN call failing: ${dhanErrorDetail}`;
  } else if (pricesAreLive && distinctLastCloseCount > 0) {
    warning = `${distinctLastCloseCount} stock${distinctLastCloseCount === 1 ? "" : "s"} lost live pricing — showing their last close`;
  } else if (pricesAreLive && quoteAgeMs > QUOTE_STALE_AFTER_MS) {
    warning = `Stale — last update ${Math.round(quoteAgeMs / 60_000)}m ago; refresh the page`;
  } else if (snapshotAgeDays !== null && snapshotAgeDays > SNAPSHOT_STALE_AFTER_DAYS) {
    warning = `Snapshot history stale — last captured ${formatShortDate(maxSnapshotDate as string)}`;
  }

  if (warning) {
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
        <span className="mr-1.5 inline-block size-1.5 rounded-full bg-amber-500 animate-pulse" />
        {warning}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-muted-foreground">
      {pricesAreLive
        ? `Prices as of ${istTimeLabel(computedAt)} IST`
        : `Prices as of ${formatShortDate(priceAsOfDate)} close`}
    </Badge>
  );
}
