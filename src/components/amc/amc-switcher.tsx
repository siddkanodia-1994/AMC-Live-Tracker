"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { AmcSwitcherEntry } from "@/lib/aum/history";

const selectClass =
  "min-w-0 max-w-[220px] rounded-md border bg-background px-2 py-1 text-sm hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

const stepButtonClass =
  "flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-sm hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

/**
 * Header control for jumping to a different AMC's detail page without going
 * back through Overview: an alphabetical dropdown (type-ahead-jump works for
 * free with a native <select>) plus Prev/Next stepping through AMCs ordered
 * by Live AUM descending -- same ordering Overview's table defaults to. Both
 * just router.push to the target AMC's own page; there's no client-side
 * state to preserve across AMCs, so a full navigation is simplest and
 * correct (each AMC page independently fetches its own data anyway).
 */
export function AmcSwitcher({ amcs, currentSlug }: { amcs: AmcSwitcherEntry[]; currentSlug: string }) {
  const router = useRouter();

  const rankOrder = useMemo(
    () =>
      [...amcs].sort((a, b) => {
        if (a.liveAumCr === null && b.liveAumCr === null) return a.overviewName.localeCompare(b.overviewName);
        if (a.liveAumCr === null) return 1;
        if (b.liveAumCr === null) return -1;
        return b.liveAumCr - a.liveAumCr;
      }),
    [amcs]
  );

  if (amcs.length === 0) return null;

  const currentRankIndex = rankOrder.findIndex((a) => a.slug === currentSlug);

  const goTo = (slug: string) => {
    if (slug && slug !== currentSlug) router.push(`/amc/${slug}`);
  };

  const step = (direction: -1 | 1) => {
    if (currentRankIndex === -1) return;
    const nextIndex = (currentRankIndex + direction + rankOrder.length) % rankOrder.length;
    goTo(rankOrder[nextIndex].slug);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={currentRankIndex === -1}
        aria-label="Previous AMC by live AUM rank"
        title="Previous AMC by live AUM rank"
        className={stepButtonClass}
      >
        ‹
      </button>
      <select
        value={currentSlug}
        onChange={(e) => goTo(e.target.value)}
        aria-label="Jump to another AMC"
        className={selectClass}
      >
        {amcs.map((a) => (
          <option key={a.slug} value={a.slug}>
            {a.overviewName}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => step(1)}
        disabled={currentRankIndex === -1}
        aria-label="Next AMC by live AUM rank"
        title="Next AMC by live AUM rank"
        className={stepButtonClass}
      >
        ›
      </button>
    </div>
  );
}
