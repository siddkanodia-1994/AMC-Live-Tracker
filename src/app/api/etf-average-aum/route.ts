import { NextResponse } from "next/server";
import { getEtfAverageAumSummary } from "@/lib/etf/average-aum";

export async function GET() {
  try {
    const summary = await getEtfAverageAumSummary();
    return NextResponse.json(summary);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to compute ETF average AUM" }, { status: 500 });
  }
}
