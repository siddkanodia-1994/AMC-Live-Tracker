import { NextResponse } from "next/server";
import { computeLiveAum, NoDataImportedError } from "@/lib/aum/compute-live-aum";
import { computeOverviewAsOf } from "@/lib/aum/overview-as-of";
import { getCanonicalSnapshotDateBounds } from "@/lib/aum/history";
import { getDailyDataQualityAlerts } from "@/lib/aum/daily-data-quality";
import { getRecentOutageReclaims } from "@/lib/aum/outage-reclaim-log";
import { getRecentStaleMappingCorrections } from "@/lib/aum/stale-mapping-reclaim";

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
    // computeLiveAum now fetches Nifty 50/500 as part of its own single
    // DHAN LTP batch (see compute-live-aum.ts) -- no second, independent
    // DHAN call to coordinate here anymore, safe to run everything
    // concurrently.
    const [snapshot, bounds, dailyDataQualityAlert, outageReclaims, staleMappingCorrections] = await Promise.all([
      computeLiveAum({ forceRefresh }),
      getCanonicalSnapshotDateBounds(),
      getDailyDataQualityAlerts().catch(() => null),
      getRecentOutageReclaims().catch(() => []),
      getRecentStaleMappingCorrections().catch(() => []),
    ]);
    return NextResponse.json({
      ...snapshot,
      asOfDate: null,
      minSnapshotDate: bounds.minDate,
      maxSnapshotDate: bounds.maxDate,
      dailyDataQualityAlert,
      outageReclaims,
      staleMappingCorrections,
    });
  } catch (err) {
    if (err instanceof NoDataImportedError) {
      return NextResponse.json({ error: err.message, code: "NO_DATA" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to compute live AUM" }, { status: 500 });
  }
}
