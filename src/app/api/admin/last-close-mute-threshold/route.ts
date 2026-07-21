import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { getAutoMuteThresholdDays, setAutoMuteThresholdDays } from "@/lib/aum/last-close-mute";
import { invalidateLiveAumCache } from "@/lib/aum/cache";

export const GET = withAdminAuth(async () => {
  const thresholdDays = await getAutoMuteThresholdDays();
  return NextResponse.json({ thresholdDays });
});

export const POST = withAdminAuth(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const thresholdDays = Number(body?.thresholdDays);

  if (!Number.isFinite(thresholdDays) || !Number.isInteger(thresholdDays) || thresholdDays < 1) {
    return NextResponse.json({ error: "thresholdDays must be a positive whole number" }, { status: 400 });
  }

  await setAutoMuteThresholdDays(thresholdDays);
  invalidateLiveAumCache();
  return NextResponse.json({ thresholdDays });
});
