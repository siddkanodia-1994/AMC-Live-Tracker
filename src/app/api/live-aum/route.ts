import { NextResponse } from "next/server";
import { computeLiveAum, NoDataImportedError } from "@/lib/aum/compute-live-aum";
import { computeOverviewAsOf } from "@/lib/aum/overview-as-of";
import { getCanonicalSnapshotDateBounds } from "@/lib/aum/history";
import { getDailyDataQualityAlerts } from "@/lib/aum/daily-data-quality";
import { refreshLiveIndexLevels } from "@/lib/aum/index-benchmarks";
import { getRecentOutageReclaims } from "@/lib/aum/outage-reclaim-log";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";
  const asOfDateRaw = url.searchParams.get("asOfDate");
  const asOfDate = asOfDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(asOfDateRaw) ? asOfDateRaw : undefined;

  try {
    if (asOfDate) {
      const snapshot = await computeOverviewAsOf(asOfDate);
      return NextResponse.json(snapshot);
    }
    // refreshLiveIndexLevels is deliberately NOT in the Promise.all below --
    // it calls DHAN's same LTP endpoint as computeLiveAum, and running both
    // at the same instant caused a real production 429 (2026-08-04):
    // DHAN's 1 request/sec limit doesn't know these are "two different
    // features," it just sees two requests land in the same second. Both
    // are now cached (see index-benchmarks.ts/cache.ts), so this sequencing
    // only costs real latency on the rare poll where both need a genuinely
    // fresh DHAN call at once.
    const snapshot = await computeLiveAum({ forceRefresh });
    const [bounds, dailyDataQualityAlert, indexLiveLevels, outageReclaims] = await Promise.all([
      getCanonicalSnapshotDateBounds(),
      getDailyDataQualityAlerts().catch(() => null),
      refreshLiveIndexLevels(),
      getRecentOutageReclaims().catch(() => []),
    ]);
    return NextResponse.json({
      ...snapshot,
      asOfDate: null,
      minSnapshotDate: bounds.minDate,
      maxSnapshotDate: bounds.maxDate,
      dailyDataQualityAlert,
      indexLiveLevels,
      outageReclaims,
    });
  } catch (err) {
    if (err instanceof NoDataImportedError) {
      return NextResponse.json({ error: err.message, code: "NO_DATA" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to compute live AUM" }, { status: 500 });
  }
}
