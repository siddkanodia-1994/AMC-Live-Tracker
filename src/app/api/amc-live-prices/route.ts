import { NextResponse } from "next/server";
import { getAmcLivePrices } from "@/lib/amc-stock/live-prices";

// Today's share price for the 8 listed AMCs (AMC Analytics' AMC tabs, and
// the live point AMC Analytics and Stock Correlation overlay on their
// price histories). Polled every 45s in market hours.
export async function GET() {
  try {
    return NextResponse.json(await getAmcLivePrices(), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load AMC live prices" }, { status: 500 });
  }
}
