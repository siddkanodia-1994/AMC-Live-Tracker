import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { getSipIndustryShowEstimate, setSipIndustryShowEstimate } from "@/lib/aum/fortnightly-update";

// A single GLOBAL, persisted toggle (not per-AMC, not per-browser) for the
// "(Estimated)" next-period row both SIP Industry cards can show -- same
// app_settings-backed pattern as /api/sip-industry-override. No auth gate,
// matching this tab's other fields.

export const GET = withErrorHandling(async () => {
  const enabled = await getSipIndustryShowEstimate();
  return NextResponse.json({ enabled });
});

// POST { enabled: boolean }
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  await setSipIndustryShowEstimate(body.enabled);
  return NextResponse.json({ ok: true, enabled: body.enabled });
});
