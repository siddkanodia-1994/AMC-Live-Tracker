import { NextResponse } from "next/server";
import { getAmcStockCorrelationData } from "@/lib/amc-stock/correlation-summary";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const blendGoldSilverParam = url.searchParams.get("blendGoldSilverAmcIds");
    const blendGoldSilverAmcIds = blendGoldSilverParam
      ? blendGoldSilverParam
          .split(",")
          .map((s) => Number(s))
          .filter((n) => Number.isFinite(n))
      : undefined;

    const { amcs, defaults } = await getAmcStockCorrelationData(blendGoldSilverAmcIds);
    return NextResponse.json({ amcs, defaults, computedAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to compute AMC stock correlation data" }, { status: 500 });
  }
}
