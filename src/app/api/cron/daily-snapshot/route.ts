import { NextResponse } from "next/server";
import { computeLiveAum, NoDataImportedError } from "@/lib/aum/compute-live-aum";
import { upsertDailyDataQuality } from "@/lib/aum/daily-data-quality";
import { clearRecoveredManualMutes, recordLastCloseLog } from "@/lib/aum/last-close-mute";
import { reclaimDhanOutages } from "@/lib/aum/outage-reclaim";
import { detectShareAdjustments } from "@/lib/aum/split-detection";
import { getIstDateString } from "@/lib/utils/date";

// Bumped from 30 -> 180: the outage-reclaim step below can fetch DHAN
// historical closes for up to a few hundred ISINs (paced ~500ms each) when
// a past-outage day needs correcting -- comfortably still under the 300s
// already proven fine for reclaim-forward-gap's admin route on this Vercel
// plan. On a normal day with nothing to correct, this step is a handful of
// cheap DB reads and returns almost instantly.
export const maxDuration = 180;

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

    // Best-effort: today's per-ISIN last-close log (feeds the Overview
    // banner's 5-day auto-mute) and clearing any manual mutes for ISINs
    // that have recovered to a real live price. This must run BEFORE
    // upsertDailyDataQuality below -- that step reads today's
    // isin_last_close_log row to compute today's coverage %, so it would
    // be blind to today's own outage signal if it ran first.
    try {
      const lastCloseIsins = snapshot.lastCloseStocks.map((s) => s.isin);
      await recordLastCloseLog(getIstDateString(), lastCloseIsins);
      await clearRecoveredManualMutes(lastCloseIsins);
    } catch (err) {
      console.error("Failed to update last-close mute bookkeeping:", err);
    }

    // Best-effort, same isolation as above: today's DHAN price-coverage
    // stats for the Daily Data tab, computed right after the close capture
    // above. Must run AFTER the last-close log write above (see comment
    // there). A failure here shouldn't fail the whole cron response -- the
    // snapshot itself is the primary job, this is a secondary
    // regression-guard signal.
    try {
      await upsertDailyDataQuality(getIstDateString());
    } catch (err) {
      console.error("Failed to upsert daily data quality:", err);
    }

    // Best-effort, same isolation as above: detect any stock split/bonus
    // that happened today (a clean-ratio overnight price jump) so live AUM
    // stops using a stale pre-split share count against a post-split price.
    // A close-to-close comparison is the only reliable signal for this, so
    // it belongs here (once daily) rather than the 45s organic poll.
    try {
      await detectShareAdjustments(getIstDateString());
    } catch (err) {
      console.error("Failed to detect share adjustments:", err);
    }

    // Nifty 50/500 levels: no separate step needed here -- computeLiveAum
    // above already fetched and persisted today's index_daily_level rows
    // as part of its own single DHAN batch (see compute-live-aum.ts).

    // Best-effort, same isolation as above: auto-detect and correct any
    // past day(s) that look like a DHAN outage (industry-wide last-close
    // fallback silently stamped in as canonical) -- only proceeds if
    // TODAY's own DHAN fetch just succeeded, so it never wastes a retry
    // while still broken. See outage-reclaim.ts.
    try {
      await reclaimDhanOutages({ todayDhanStatus: snapshot.dhanStatus });
    } catch (err) {
      console.error("Failed to reclaim DHAN outages:", err);
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
