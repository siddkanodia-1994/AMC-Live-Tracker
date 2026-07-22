import { NextResponse } from "next/server";
import { computeLiveAum, NoDataImportedError } from "@/lib/aum/compute-live-aum";
import { invalidateLiveAumCache } from "@/lib/aum/cache";
import { dismissLastCloseStocksForToday } from "@/lib/aum/last-close-dismissal";

// No auth gate -- same public, low-blast-radius precedent as Check now
// (/api/live-aum?refresh=1): non-destructive, resets automatically at IST
// midnight, instantly reversible (a new poll re-shows the banner the moment
// a different stock joins the flagged set).
export async function POST() {
  try {
    const current = await computeLiveAum({ forceRefresh: false });
    const activeIsins = current.lastCloseStocks.filter((s) => !s.autoMuted).map((s) => s.isin);
    if (activeIsins.length === 0) {
      return NextResponse.json(current);
    }

    await dismissLastCloseStocksForToday(activeIsins);
    // Dismissing is a pure DB write -- it needs zero fresh DHAN prices to be
    // reflected, only the already-known resulting flag. Patch the snapshot
    // already fetched above instead of forcing a second full DHAN re-fetch
    // (forceRefresh: true bypasses the 45s cache/cooldown unconditionally,
    // and doing that on every Ignore/Accept click was enough to trip DHAN's
    // own rate limit -- see the plan's audit). invalidateLiveAumCache lets
    // *other* visitors' next natural poll pick up the change instead.
    invalidateLiveAumCache();
    return NextResponse.json({ ...current, lastCloseDismissedToday: true });
  } catch (err) {
    if (err instanceof NoDataImportedError) {
      return NextResponse.json({ error: err.message, code: "NO_DATA" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
  }
}
