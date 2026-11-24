import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { getValuationTargetFy, setValuationTargetFy } from "@/lib/valuation/estimate-store";
import { isTargetFy, MAX_TARGET_FY, MIN_TARGET_FY } from "@/lib/valuation/target-year";

// The Valuation Model's shared target year (FY28E, FY29E, ...): GET
// { fiscalYear }, POST { fiscalYear }. One choice for every AMC and
// visitor; open like the other AMC Analytics saves.
export const GET = withErrorHandling(async () => {
  return NextResponse.json({ fiscalYear: await getValuationTargetFy() });
});

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const fiscalYear = body?.fiscalYear;
  if (!isTargetFy(fiscalYear)) {
    return NextResponse.json({ error: `fiscalYear must be a whole year from ${MIN_TARGET_FY} to ${MAX_TARGET_FY}` }, { status: 400 });
  }
  await setValuationTargetFy(fiscalYear);
  return NextResponse.json({ fiscalYear });
});
