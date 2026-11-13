import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { getAmcAnalyticsScore } from "@/lib/aum/amc-analytics-inputs";

// The AMC Score card on its own (it comes from the external AMC Score
// project), so a slow or failing fetch only holds up that card.
export const GET = withErrorHandling(async (request: Request) => {
  const amcId = Number(new URL(request.url).searchParams.get("amcId"));
  if (!Number.isInteger(amcId)) return NextResponse.json({ error: "amcId is required" }, { status: 400 });
  const score = await getAmcAnalyticsScore(amcId);
  if (!score) return NextResponse.json({ error: "Unknown amcId" }, { status: 404 });
  return NextResponse.json(score);
});
