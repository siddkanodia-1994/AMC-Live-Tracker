import { NextResponse } from "next/server";
import { getDailyDataQualityHistory } from "@/lib/aum/daily-data-quality";

export async function GET() {
  try {
    const rows = await getDailyDataQualityHistory();
    return NextResponse.json({ rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load daily data quality history" }, { status: 500 });
  }
}
