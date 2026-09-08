import { NextResponse } from "next/server";
import { getEtfReportedAumTotalsByAmc } from "@/lib/etf/compute-live-aum";

export async function GET() {
  try {
    const totals = await getEtfReportedAumTotalsByAmc();
    return NextResponse.json({ totalsByAmc: Object.fromEntries(totals) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to compute Gold/Silver AUM totals by AMC" }, { status: 500 });
  }
}
