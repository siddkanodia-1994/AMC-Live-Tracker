import { NextResponse } from "next/server";
import { computeLiveAum, NoDataImportedError } from "@/lib/aum/compute-live-aum";
import { upsertDailyDataQuality } from "@/lib/aum/daily-data-quality";
import { clearRecoveredManualMutes, recordLastCloseLog } from "@/lib/aum/last-close-mute";
import { getIstDateString } from "@/lib/utils/date";

export const maxDuration = 30;

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically when
// CRON_SECRET is set — this keeps the endpoint from being triggerable by
// anyone who finds the URL. computeLiveAum's daily-snapshot side effect is
// idempotent (unique amcId+snapshotDate), so retries/duplicate invocations
// are harmless. Fails closed if CRON_SECRET is missing (e.g. a preview
// deployment or an accidental env var deletion) rather than silently
// accepting unauthenticated requests.
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error("CRON_SECRET is not configured — refusing to run the daily snapshot");
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await computeLiveAum({ forceRefresh: true });

    // Best-effort: today's DHAN price-coverage stats for the Daily Data
    // tab, computed right after the close capture above. A failure here
    // shouldn't fail the whole cron response -- the snapshot itself is
    // the primary job, this is a secondary regression-guard signal.
    try {
      await upsertDailyDataQuality(getIstDateString());
    } catch (err) {
      console.error("Failed to upsert daily data quality:", err);
    }

    // Best-effort, same isolation as above: today's per-ISIN last-close log
    // (feeds the Overview banner's 5-day auto-mute) and clearing any manual
    // mutes for ISINs that have recovered to a real live price. Neither
    // should fail the whole cron response if something goes wrong here.
    try {
      const lastCloseIsins = snapshot.lastCloseStocks.map((s) => s.isin);
      await recordLastCloseLog(getIstDateString(), lastCloseIsins);
      await clearRecoveredManualMutes(lastCloseIsins);
    } catch (err) {
      console.error("Failed to update last-close mute bookkeeping:", err);
    }

    return NextResponse.json({ ok: true, amcsSnapshotted: snapshot.amcs.length });
  } catch (err) {
    if (err instanceof NoDataImportedError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 200 });
    }
    console.error(err);
    return NextResponse.json({ ok: false, error: "Daily snapshot failed" }, { status: 500 });
  }
}
