import { NextResponse } from "next/server";
import { getSectoralHoldings } from "@/lib/aum/sectoral-holdings";
import { NoDataImportedError } from "@/lib/aum/compute-live-aum";

export async function GET(request: Request) {
  try {
    const period = new URL(request.url).searchParams.get("period") ?? undefined;
    const result = await getSectoralHoldings(period);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NoDataImportedError) {
      return NextResponse.json({ error: err.message, code: "NO_DATA" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to compute sectoral holdings" }, { status: 500 });
  }
}
