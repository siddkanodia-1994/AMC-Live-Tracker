import { NextResponse } from "next/server";
import { getAllMonthlyFlows } from "@/lib/aum/industry-flows";

export async function GET() {
  try {
    const points = await getAllMonthlyFlows();
    return NextResponse.json({ points });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to load industry monthly flows" }, { status: 500 });
  }
}
