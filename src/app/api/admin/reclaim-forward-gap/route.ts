import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { db } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema";
import { reclaimForwardGap, setReclaimStatusForPeriod } from "@/lib/aum/reclaim-forward-gap";

// Bundles instrument sync (a several-second DHAN CSV download+parse on its
// own -- see sync-instruments/route.ts's own 60s budget) with the reclaim's
// backfill + Daily Data recompute. Measured end-to-end at ~65-70s even in
// the warm-cache case, so this needs more headroom than the other two admin
// routes rather than sharing their 60s ceiling.
export const maxDuration = 300;

export const POST = withAdminAuth(async () => {
  // Read the period BEFORE running, not from the result -- if reclaimForwardGap()
  // throws before returning, this is still the period a manual run just
  // attempted, so the Admin banner's status can be corrected either way.
  const [periodRow] = await db.select().from(appSettings).where(eq(appSettings.key, "current_report_period"));
  const reportPeriod = periodRow?.value;

  try {
    const result = await reclaimForwardGap();
    if (reportPeriod) await setReclaimStatusForPeriod(reportPeriod, "success", null);
    return NextResponse.json(result);
  } catch (err) {
    if (reportPeriod) {
      await setReclaimStatusForPeriod(reportPeriod, "failed", err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
});
