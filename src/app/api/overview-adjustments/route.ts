import { NextResponse } from "next/server";
import { getOverviewAdjustments } from "@/lib/aum/overview-adjustments";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reportPeriodRaw = url.searchParams.get("reportPeriod");
  const reportPeriod = reportPeriodRaw && /^\d{4}-\d{2}$/.test(reportPeriodRaw) ? reportPeriodRaw : undefined;
  const avgFromRaw = url.searchParams.get("avgFrom");
  const avgFrom = avgFromRaw && /^\d{4}-\d{2}-\d{2}$/.test(avgFromRaw) ? avgFromRaw : undefined;
  const avgToRaw = url.searchParams.get("avgTo");
  const avgTo = avgToRaw && /^\d{4}-\d{2}-\d{2}$/.test(avgToRaw) ? avgToRaw : undefined;
  const currentAvgFromRaw = url.searchParams.get("currentAvgFrom");
  const currentAvgFrom = currentAvgFromRaw && /^\d{4}-\d{2}-\d{2}$/.test(currentAvgFromRaw) ? currentAvgFromRaw : undefined;
  const currentAvgToRaw = url.searchParams.get("currentAvgTo");
  const currentAvgTo = currentAvgToRaw && /^\d{4}-\d{2}-\d{2}$/.test(currentAvgToRaw) ? currentAvgToRaw : undefined;
  const histLiveDateRaw = url.searchParams.get("histLiveDate");
  const histLiveDate = histLiveDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(histLiveDateRaw) ? histLiveDateRaw : undefined;

  try {
    const result = await getOverviewAdjustments({
      reportPeriod,
      avgFrom,
      avgTo,
      currentAvgFrom,
      currentAvgTo,
      histLiveDate,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Failed to compute overview adjustments";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
