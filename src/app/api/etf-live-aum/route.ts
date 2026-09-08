import { NextResponse } from "next/server";
import { computeEtfLiveAum } from "@/lib/etf/compute-live-aum";

export async function GET() {
  try {
    const schemes = await computeEtfLiveAum();
    return NextResponse.json({ schemes, computedAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to compute ETF live AUM" }, { status: 500 });
  }
}
