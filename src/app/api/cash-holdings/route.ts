import { NextResponse } from "next/server";
import { getCashHoldingsHistory } from "@/lib/aum/cash-holdings";
import { NoDataImportedError } from "@/lib/aum/compute-live-aum";

export async function GET() {
  try {
    const result = await getCashHoldingsHistory();
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NoDataImportedError) {
      return NextResponse.json({ error: err.message, code: "NO_DATA" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to compute cash holdings history" }, { status: 500 });
  }
}
