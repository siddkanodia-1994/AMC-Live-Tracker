import { NextResponse } from "next/server";
import { computeLiveAum, NoDataImportedError } from "@/lib/aum/compute-live-aum";
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
    const fresh = await computeLiveAum({ forceRefresh: true });
    return NextResponse.json(fresh);
  } catch (err) {
    if (err instanceof NoDataImportedError) {
      return NextResponse.json({ error: err.message, code: "NO_DATA" }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json({ error: "Failed to dismiss" }, { status: 500 });
  }
}
