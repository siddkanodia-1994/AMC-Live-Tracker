import { NextResponse } from "next/server";
import { getAmcStockCorrelationData } from "@/lib/amc-stock/correlation-summary";

export async function GET() {
  try {
    const { amcs, defaults } = await getAmcStockCorrelationData();
    return NextResponse.json({ amcs, defaults, computedAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to compute AMC stock correlation data" }, { status: 500 });
  }
}
