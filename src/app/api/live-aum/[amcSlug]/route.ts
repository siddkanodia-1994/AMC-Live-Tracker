import { NextResponse } from "next/server";
import { computeAmcAsOf } from "@/lib/aum/amc-as-of";
import { computeLiveAumForAmc, NoDataImportedError } from "@/lib/aum/compute-live-aum";

export async function GET(request: Request, { params }: { params: Promise<{ amcSlug: string }> }) {
  const { amcSlug } = await params;
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";
  const asOfDateRaw = url.searchParams.get("asOfDate");
  const asOfDate = asOfDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(asOfDateRaw) ? asOfDateRaw : undefined;

  try {
    const result = asOfDate ? await computeAmcAsOf(amcSlug, asOfDate) : await computeLiveAumForAmc(amcSlug, { forceRefresh });
    if (!result) {
      return NextResponse.json({ error: `No AMC found with slug "${amcSlug}"` }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NoDataImportedError) {
      return NextResponse.json({ error: err.message, code: "NO_DATA" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to compute live AUM" }, { status: 500 });
  }
}
