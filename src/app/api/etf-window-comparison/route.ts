import { NextResponse } from "next/server";
import { getEtfDataBounds, getEtfWindowComparison } from "@/lib/etf/window-comparison";

// GET ?w1Start&w1End&w2Start&w2End -- both windows' figures (avg + exit AUM)
// per scheme plus the Price-only % between them, mirroring /api/overview-
// adjustments' own raw-date-param convention. Always includes dataBounds so
// the client can populate its quarter dropdowns without a separate call.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const w1Start = url.searchParams.get("w1Start");
    const w1End = url.searchParams.get("w1End");
    const w2Start = url.searchParams.get("w2Start");
    const w2End = url.searchParams.get("w2End");

    const dataBounds = await getEtfDataBounds();

    if (!w1Start || !w1End || !w2Start || !w2End) {
      return NextResponse.json({ dataBounds, rows: [] });
    }

    const rows = await getEtfWindowComparison({ start: w1Start, end: w1End }, { start: w2Start, end: w2End });
    return NextResponse.json({ dataBounds, rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to compute ETF window comparison" }, { status: 500 });
  }
}
