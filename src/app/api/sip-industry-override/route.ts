import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { getSipIndustryAnchorOverride, setSipIndustryAnchorOverride, getLastRealMonthInQuarter } from "@/lib/aum/fortnightly-update";
import { getAllMonthlyFlows } from "@/lib/aum/industry-flows";

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

// POST { month: "YYYY-MM" | null } -- set directly (used by the Monthly
// card's own Month/Year pickers), OR
// POST { quarterFy: number, quarter: number } -- used by the Quarterly
// card's own Quarter/FY pickers, which resolves to the LAST REAL AMFI
// month inside that quarter server-side (see getLastRealMonthInQuarter);
// a quarter with no real data at all yet (e.g. one that hasn't started
// reporting) returns a 400 instead of silently guessing a month.
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => ({}));

  if (typeof body?.quarterFy === "number" && typeof body?.quarter === "number") {
    const flows = await getAllMonthlyFlows();
    const month = getLastRealMonthInQuarter(flows, body.quarterFy, body.quarter);
    if (month === null) {
      const label = `Q${body.quarter}FY${String(body.quarterFy).slice(-2)}`;
      return NextResponse.json({ error: `No real AMFI data exists for ${label} yet` }, { status: 400 });
    }
    await setSipIndustryAnchorOverride(month.slice(0, 7));
    return NextResponse.json({ ok: true, month: month.slice(0, 7) });
  }

  const month = body?.month;
  if (month !== null && (typeof month !== "string" || !MONTH_PATTERN.test(month))) {
    return NextResponse.json({ error: "month must be a YYYY-MM string or null" }, { status: 400 });
  }
  await setSipIndustryAnchorOverride(month);
  return NextResponse.json({ ok: true, month });
});
