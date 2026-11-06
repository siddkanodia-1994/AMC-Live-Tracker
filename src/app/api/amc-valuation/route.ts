import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { getAmcValuationSeries } from "@/lib/valuation/store";

// GET ?slug=<amc slug> -- one AMC's daily PE and Mcap/Sales for the Stock
// Correlation tab's band charts.
export const GET = withErrorHandling(async (request: Request) => {
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 });
  const series = await getAmcValuationSeries(slug);
  if (!series) return NextResponse.json({ error: `No AMC found with slug "${slug}"` }, { status: 404 });
  return NextResponse.json(series);
});
