import { NextResponse } from "next/server";
import { getTotalAumGrowth } from "@/lib/aum/total-aum-growth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedAsOfDateRaw = url.searchParams.get("asOfDate");
  const requestedAsOfDate =
    requestedAsOfDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(requestedAsOfDateRaw) ? requestedAsOfDateRaw : undefined;
  const requestedReportPeriodRaw = url.searchParams.get("reportPeriod");
  const requestedReportPeriod =
    requestedReportPeriodRaw && /^\d{4}-\d{2}$/.test(requestedReportPeriodRaw) ? requestedReportPeriodRaw : undefined;

  try {
    const result = await getTotalAumGrowth({ asOfDate: requestedAsOfDate, reportPeriod: requestedReportPeriod });
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Failed to compute total AUM growth";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
