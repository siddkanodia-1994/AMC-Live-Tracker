import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { reclaimForwardGap } from "@/lib/aum/reclaim-forward-gap";

// Bundles instrument sync (a several-second DHAN CSV download+parse on its
// own -- see sync-instruments/route.ts's own 60s budget) with the reclaim's
// backfill + Daily Data recompute. Measured end-to-end at ~65-70s even in
// the warm-cache case, so this needs more headroom than the other two admin
// routes rather than sharing their 60s ceiling.
export const maxDuration = 300;

export const POST = withAdminAuth(async () => {
  const result = await reclaimForwardGap();
  return NextResponse.json(result);
});
