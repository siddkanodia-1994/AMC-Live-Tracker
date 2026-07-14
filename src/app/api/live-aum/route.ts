import { NextResponse } from "next/server";
import { computeLiveAum, NoDataImportedError } from "@/lib/aum/compute-live-aum";
import { computeOverviewAsOf } from "@/lib/aum/overview-as-of";
import { getCanonicalSnapshotDateBounds } from "@/lib/aum/history";
import { getDailyDataQualityAlerts } from "@/lib/aum/daily-data-quality";

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
    const [snapshot, bounds, dailyDataQualityAlert] = await Promise.all([
      computeLiveAum({ forceRefresh }),
      getCanonicalSnapshotDateBounds(),
      getDailyDataQualityAlerts().catch(() => null),
    ]);
    return NextResponse.json({
      ...snapshot,
      asOfDate: null,
      minSnapshotDate: bounds.minDate,
      maxSnapshotDate: bounds.maxDate,
      dailyDataQualityAlert,
    });
  } catch (err) {
    if (err instanceof NoDataImportedError) {
      return NextResponse.json({ error: err.message, code: "NO_DATA" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to compute live AUM" }, { status: 500 });
  }
}
