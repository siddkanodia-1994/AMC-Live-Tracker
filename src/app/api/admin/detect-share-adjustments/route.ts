import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { invalidateLiveAumCache } from "@/lib/aum/cache";
import { detectShareAdjustments } from "@/lib/aum/split-detection";
import { getIstDateString } from "@/lib/utils/date";

// Retroactive/escape-hatch trigger for split detection. The daily cron only
// ever compares "today vs. yesterday" going forward -- this lets an operator
// immediately backfill a split that already happened before the feature
// shipped (or recover from a day the cron failed to run), by passing an
// explicit past date.
export const POST = withAdminAuth(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const date = typeof body?.date === "string" && body.date.trim() ? body.date.trim() : getIstDateString();

  const result = await detectShareAdjustments(date);
  invalidateLiveAumCache();
  return NextResponse.json({ date, ...result });
});
