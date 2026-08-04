import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { computeLiveAum } from "@/lib/aum/compute-live-aum";
import { reclaimDhanOutages } from "@/lib/aum/outage-reclaim";

// Convenience trigger for the same automatic DHAN-outage detection+
// correction the daily cron already runs (outage-reclaim.ts) -- lets an
// operator force an immediate correction right after fixing a broken DHAN
// token instead of waiting for the next 4:05pm IST cron run. Not a
// confirmation gate: the cron path never depends on this being clicked.
export const maxDuration = 180;

export const POST = withAdminAuth(async () => {
  const snapshot = await computeLiveAum({ forceRefresh: true });
  const result = await reclaimDhanOutages({ todayDhanStatus: snapshot.dhanStatus });
  return NextResponse.json(result);
});
