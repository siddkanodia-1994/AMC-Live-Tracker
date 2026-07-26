import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { invalidateLiveAumCache } from "@/lib/aum/cache";
import { computeLiveAum } from "@/lib/aum/compute-live-aum";
import { dismissShareAdjustment } from "@/lib/aum/share-adjustments";

const MAX_REASON_LENGTH = 500;

// Admin-gated (unlike the public Accept/Ignore last-close routes): dismissing
// a wrong auto-detected split changes real AUM values shown to every
// visitor, not just a display flag, so it's treated as a deliberate admin
// override rather than a routine low-stakes click.
export const POST = withAdminAuth(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const isin = typeof body?.isin === "string" ? body.isin.trim() : "";
  const reportPeriod = typeof body?.reportPeriod === "string" ? body.reportPeriod.trim() : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (!isin || !reportPeriod || !reason) {
    return NextResponse.json({ error: "isin, reportPeriod, and reason are required" }, { status: 400 });
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return NextResponse.json({ error: `reason must be ${MAX_REASON_LENGTH} characters or fewer` }, { status: 400 });
  }

  await dismissShareAdjustment(isin, reportPeriod, reason);
  invalidateLiveAumCache();
  // Unlike Accept/Ignore (a pure flag patch), this changes real
  // liveMarketValueCr/deltaCr/deltaPct across every AMC holding this ISIN --
  // not cheaply hand-patchable, so a recompute is warranted here. Rare admin
  // action, not a routine click, so the extra recompute is an acceptable cost.
  const fresh = await computeLiveAum({ forceRefresh: false });
  return NextResponse.json(fresh);
});
