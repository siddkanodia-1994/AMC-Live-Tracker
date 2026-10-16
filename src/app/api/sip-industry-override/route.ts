import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { getSipIndustryAnchorOverride, setSipIndustryAnchorOverride } from "@/lib/aum/fortnightly-update";

// A single GLOBAL override (not per-AMC) of which month counts as "latest
// available" for the Fortnightly tab's SIP Industry Growth cards (Monthly
// and Quarterly -- one setting drives both, since a month always implies
// exactly one fiscal quarter). Industry-wide data is identical for every
// AMC, so this intentionally isn't scoped by amcId the way the rest of
// this tab's fields are. No auth gate, matching this tab's other fields
// (explicit prior choice -- see /api/fortnightly-update's own route).

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export const GET = withErrorHandling(async () => {
  const month = await getSipIndustryAnchorOverride();
  return NextResponse.json({ month });
});

// POST { month: "YYYY-MM" | null }
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const month = body?.month;
  if (month !== null && (typeof month !== "string" || !MONTH_PATTERN.test(month))) {
    return NextResponse.json({ error: "month must be a YYYY-MM string or null" }, { status: 400 });
  }
  await setSipIndustryAnchorOverride(month);
  return NextResponse.json({ ok: true, month });
});
