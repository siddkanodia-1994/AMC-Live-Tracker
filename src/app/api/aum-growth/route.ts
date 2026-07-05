import { NextResponse } from "next/server";
import { getAumGrowthComparison, getAvailableReportPeriods } from "@/lib/aum/aum-growth";

export async function GET(request: Request) {
  const url = new URL(request.url);

  try {
    const periods = await getAvailableReportPeriods();
    if (periods.length < 2) {
      return NextResponse.json({ periods, periodA: null, periodB: null, rows: [] });
    }

    const requestedA = url.searchParams.get("periodA");
    const requestedB = url.searchParams.get("periodB");
    const periodA = requestedA && periods.includes(requestedA) ? requestedA : periods[periods.length - 2];
    const periodB = requestedB && periods.includes(requestedB) ? requestedB : periods[periods.length - 1];

    const rows = await getAumGrowthComparison(periodA, periodB);
    return NextResponse.json({ periods, periodA, periodB, rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to compute AUM growth comparison" }, { status: 500 });
  }
}
