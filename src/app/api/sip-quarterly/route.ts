import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { getSipQuarterlyMatrix } from "@/lib/aum/sip-quarterly";

// Every listed AMC's quarterly SIP history (AMC Analytics › SIP & Score's
// cross-AMC table). Read-only; figures are edited on the SIP cards.
export const GET = withErrorHandling(async () => {
  return NextResponse.json({ amcs: await getSipQuarterlyMatrix() });
});
