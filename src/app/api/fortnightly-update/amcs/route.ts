import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { getFortnightlyEligibleAmcs } from "@/lib/aum/fortnightly-update";

export const GET = withErrorHandling(async () => {
  const amcs = await getFortnightlyEligibleAmcs();
  return NextResponse.json({ amcs });
});
