import { useMemo } from "react";
import useSWR from "swr";
import type { OverviewAdjustments, OverviewAdjustmentsSlice, OverviewAdjustmentsField } from "@/lib/aum/overview-adjustments";
import { useActiveGoldSilverBlendAmcIds } from "@/components/layout/gold-silver-blend-context";

async function fetcher(url: string): Promise<OverviewAdjustmentsSlice> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed with status ${res.status}`);
  }
  return res.json();
}

function buildUrl(fields: OverviewAdjustmentsField[], params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  sp.set("fields", fields.join(","));
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value);
  }
  return `/api/overview-adjustments?${sp.toString()}`;
}

// Reported AUM per period and both Avg AUM windows are all pure historical
// DB aggregates -- no DHAN calls, no polling needed. keepPreviousData avoids
// flashing back to the default figures while a new selection's fetch is
// still in flight.
//
// Split into 4 independent SWR requests -- one per "window" the Overview
// dropdowns can change (avg window, current-avg window, hist-live date,
// reported-AUM period) -- each keyed ONLY on the params it actually needs,
// via the `fields` param on /api/overview-adjustments (see
// src/lib/aum/overview-adjustments.ts). Previously this was a single
// request keyed on all 6 params together, so changing e.g. just the "Avg
// AUM window" quarter re-fetched (and server-side, re-computed) the other
// 3 windows too, even though none of their own params had changed. Each
// slice below still asks the server to resolve every window's dates (a
// cheap, non-per-AMC lookup, see getOverviewAdjustments), so any one slice
// alone has everything needed for the merge below -- only the heavy
// per-AMC/index fields differ between slices.
export function useOverviewAdjustments(
  reportPeriod?: string,
  avgFrom?: string,
  avgTo?: string,
  currentAvgFrom?: string,
  currentAvgTo?: string,
  histLiveDate?: string
) {
  const blendGoldSilverAmcIds = useActiveGoldSilverBlendAmcIds();
  const blend = blendGoldSilverAmcIds.length > 0 ? blendGoldSilverAmcIds.join(",") : undefined;
  const swrOptions = { revalidateOnFocus: false, keepPreviousData: true } as const;

  const avgWindow = useSWR<OverviewAdjustmentsSlice>(
    buildUrl(["avgAum", "indexAvg"], { avgFrom, avgTo, blendGoldSilverAmcIds: blend }),
    fetcher,
    swrOptions
  );
  const currentAvgWindow = useSWR<OverviewAdjustmentsSlice>(
    buildUrl(["currentAvgAum", "indexCurrentAvg"], { currentAvgFrom, currentAvgTo, blendGoldSilverAmcIds: blend }),
    fetcher,
    swrOptions
  );
  const histLive = useSWR<OverviewAdjustmentsSlice>(
    buildUrl(["histLiveAum", "indexHistLive"], { histLiveDate, blendGoldSilverAmcIds: blend }),
    fetcher,
    swrOptions
  );
  const reportedAum = useSWR<OverviewAdjustmentsSlice>(buildUrl(["reportedAum"], { reportPeriod }), fetcher, swrOptions);

  // Merged back into the exact same OverviewAdjustments shape every
  // existing caller of `adjustments.data` already expects -- `undefined`
  // until all 4 slices have resolved at least once (matching the previous
  // single-request "nothing until it's all there" behavior); with
  // keepPreviousData on each slice, this stays fully populated (serving
  // stale-but-valid data for whichever window didn't just change) after
  // the first load, so changing one dropdown never blanks the others.
  const data = useMemo<OverviewAdjustments | undefined>(() => {
    const a = avgWindow.data;
    const b = currentAvgWindow.data;
    const c = histLive.data;
    const d = reportedAum.data;
    if (!a || !b || !c || !d) return undefined;
    // Each slice is guaranteed (by the `fields` it was requested with,
    // above) to carry the specific heavy fields read off it here -- the
    // non-null assertions are enforced by this function's own code, not a
    // hope about server behavior.
    return {
      reportPeriod: d.reportPeriod,
      availableReportPeriods: d.availableReportPeriods,
      reportedAumByAmcId: d.reportedAumByAmcId!,
      avgFrom: a.avgFrom,
      avgTo: a.avgTo,
      avgAumByAmcId: a.avgAumByAmcId!,
      currentAvgFrom: b.currentAvgFrom,
      currentAvgTo: b.currentAvgTo,
      currentAvgAumByAmcId: b.currentAvgAumByAmcId!,
      minSnapshotDate: a.minSnapshotDate,
      maxSnapshotDate: a.maxSnapshotDate,
      histLiveDate: c.histLiveDate,
      histLiveAumByAmcId: c.histLiveAumByAmcId!,
      indexAvgLevelByKey: a.indexAvgLevelByKey!,
      indexCurrentAvgLevelByKey: b.indexCurrentAvgLevelByKey!,
      indexHistLiveLevelByKey: c.indexHistLiveLevelByKey!,
    };
  }, [avgWindow.data, currentAvgWindow.data, histLive.data, reportedAum.data]);

  return {
    data,
    error: avgWindow.error ?? currentAvgWindow.error ?? histLive.error ?? reportedAum.error,
  };
}
