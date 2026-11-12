import { NextResponse } from "next/server";
import { computeLiveAum, NoDataImportedError } from "@/lib/aum/compute-live-aum";
import { upsertDailyDataQuality } from "@/lib/aum/daily-data-quality";
import { clearRecoveredManualMutes, getAutoMuteThresholdDays, recordLastCloseLog } from "@/lib/aum/last-close-mute";
import { reclaimDhanOutages } from "@/lib/aum/outage-reclaim";
import { reclaimStaleInstrumentMappings } from "@/lib/aum/stale-mapping-reclaim";
import { detectShareAdjustments } from "@/lib/aum/split-detection";
import { runEtfIngestion } from "@/lib/etf/ingest";
import { runMcxIngestion } from "@/lib/mcx/ingest";
import { runAmcStockIngestion } from "@/lib/amc-stock/ingest";
import { createDailyFortnightlySnapshots } from "@/lib/aum/fortnightly-update";
import { runAmfiMonthlyFlowIngestion } from "@/lib/aum/amfi-monthly-flows";
import { getAllMonthlyFlows, upsertMonthlyFlow } from "@/lib/aum/industry-flows";
import { getIstDateString } from "@/lib/utils/date";
import { flushOpsRun, hasCompletedRunSince, runOpsStep, startOpsRun } from "@/lib/ops/run-log";

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

  // ?mode=retry is the later (18:05 IST) safety-net invocation: it does
  // nothing if today's earlier run already completed (ok/warn in
  // ops_run_log), and otherwise runs the exact same pipeline. Every step
  // below is idempotent for a same-day re-run (see the pre-mortem notes in
  // runEtfIngestion's split check).
  const mode = new URL(request.url).searchParams.get("mode") === "retry" ? "retry" : "primary";
  const run = startOpsRun("cron", "daily-snapshot");
  const runStarted = Date.now();
  if (mode === "retry") {
    const istMidnightUtc = new Date(`${getIstDateString()}T00:00:00+05:30`).toISOString();
    if (await hasCompletedRunSince("daily-snapshot", istMidnightUtc).catch(() => false)) {
      run.rows.push({ node: "run-complete", status: "skipped", summary: "mode=retry; earlier run already completed today" });
      await flushOpsRun(run);
      return NextResponse.json({ ok: true, skipped: true });
    }
  }

  try {
    const computeStarted = Date.now();
    const snapshot = await computeLiveAum({ forceRefresh: true });
    run.rows.push({
      node: "computeLiveAum",
      status: snapshot.dhanStatus === "ok" ? "ok" : snapshot.dhanStatus === "degraded" ? "warn" : "fail",
      summary: `${snapshot.amcs.length} AMCs snapshotted, DHAN ${snapshot.dhanStatus}, ${snapshot.lastCloseStocks.length} on last close`,
      details: { dhanStatus: snapshot.dhanStatus, priceAsOfDate: snapshot.priceAsOfDate, amcs: snapshot.amcs.length },
      durationMs: Date.now() - computeStarted,
    });

    // Best-effort: today's per-ISIN last-close log (feeds the Overview
    // banner's 5-day auto-mute) and clearing any manual mutes for ISINs
    // that have recovered to a real live price. This must run BEFORE
    // upsertDailyDataQuality below -- that step reads today's
    // isin_last_close_log row to compute today's coverage %, so it would
    // be blind to today's own outage signal if it ran first.
    await runOpsStep(run, "lastCloseBookkeeping", async () => {
      const lastCloseIsins = snapshot.lastCloseStocks.map((s) => s.isin);
      await recordLastCloseLog(getIstDateString(), lastCloseIsins);
      await clearRecoveredManualMutes(lastCloseIsins);
      return { lastCloseCount: lastCloseIsins.length };
    }, (r) => ({ summary: `${r.lastCloseCount} ISINs on last close`, details: r }));

    // Best-effort, same isolation as above: today's DHAN price-coverage
    // stats for the Daily Data tab, computed right after the close capture
    // above. Must run AFTER the last-close log write above (see comment
    // there). A failure here shouldn't fail the whole cron response -- the
    // snapshot itself is the primary job, this is a secondary
    // regression-guard signal.
    await runOpsStep(run, "upsertDailyDataQuality", () => upsertDailyDataQuality(getIstDateString()), (r) => ({ details: r ? { ...r } : { row: null } }));

    // Best-effort, same isolation as above: detect any stock split/bonus
    // that happened today (a clean-ratio overnight price jump) so live AUM
    // stops using a stale pre-split share count against a post-split price.
    // A close-to-close comparison is the only reliable signal for this, so
    // it belongs here (once daily) rather than the 45s organic poll.
    await runOpsStep(run, "detectShareAdjustments", () => detectShareAdjustments(getIstDateString()), (r) => ({ summary: `${r.detectedCount} split/bonus adjustments detected`, details: { ...r } }));

    // Best-effort, same isolation as above: auto-create the Fortnightly AMC
    // Update snapshot row for every eligible AMC (carrying forward manual
    // fields, same as the "+ New fortnightly update" button), dated
    // snapshot.priceAsOfDate -- NOT getIstDateString() -- so this always
    // tracks the last date real listed-price data actually exists for.
    // computeLiveAum already resolves this correctly (today on a real
    // trading day with data, otherwise the last real trading day via
    // lastTradingDayIstString()), so a weekday holiday (e.g. the cron
    // firing on a market-closed Tuesday) re-resolves to the already-
    // existing last-trading-day row instead of stamping a bogus new date
    // -- a no-op thanks to onConflictDoNothing, not a phantom snapshot.
    await runOpsStep(run, "createDailyFortnightlySnapshots", async () => {
      const count = await createDailyFortnightlySnapshots(snapshot.priceAsOfDate);
      console.log(`Auto-created fortnightly snapshots for ${count} AMCs (as of ${snapshot.priceAsOfDate})`);
      return count;
    }, (count) => ({ summary: `${count} AMCs (as of ${snapshot.priceAsOfDate})`, details: { count, asOfDate: snapshot.priceAsOfDate } }));

    // Nifty 50/500 levels: no separate step needed here -- computeLiveAum
    // above already fetched and persisted today's index_daily_level rows
    // as part of its own single DHAN batch (see compute-live-aum.ts).

    // Best-effort, same isolation as above: auto-detect and correct any
    // past day(s) that look like a DHAN outage (industry-wide last-close
    // fallback silently stamped in as canonical) -- only proceeds if
    // TODAY's own DHAN fetch just succeeded, so it never wastes a retry
    // while still broken. See outage-reclaim.ts.
    await runOpsStep(run, "reclaimDhanOutages", () => reclaimDhanOutages({ todayDhanStatus: snapshot.dhanStatus }), (r) => ({ summary: `AMC dates ${r.amc.datesProcessed.length}, index dates ${r.index.datesProcessed.length}`, details: { ...r } }));

    // Best-effort, same isolation as above: a single ISIN stuck on
    // last_close for the auto-mute threshold's worth of trading days
    // (timer-based mute only, not a manually-accepted known reason) is
    // never enough to trip reclaimDhanOutages' whole-day 50% threshold
    // above, so it needs its own check -- that streak length is exactly
    // the signature of a stale DHAN security ID (confirmed real incident,
    // 2026-08-10; also HFCL, 2026-09-07). See stale-mapping-reclaim.ts.
    //
    // Triggers on daysUnchanged (derived straight from isin_daily_price)
    // as well as the autoMuted flag (derived from isin_last_close_log),
    // not autoMuted alone -- the log write above is best-effort and can
    // silently miss a day (confirmed: HFCL's own log had a gap despite
    // isin_daily_price correctly showing it stuck), which breaks the
    // log-based mute streak and left a genuine ID drift undetected for
    // days. daysUnchanged has no such gap, so this is a strictly additive
    // safety net -- every ISIN that qualified via autoMuted still does.
    await runOpsStep(run, "reclaimStaleInstrumentMappings", async () => {
      const thresholdDays = await getAutoMuteThresholdDays();
      const staleMappingCandidates = snapshot.lastCloseStocks
        .filter((s) => s.muteReason === null && (s.autoMuted || (s.daysUnchanged ?? 0) >= thresholdDays))
        .map((s) => ({ isin: s.isin, companyName: s.companyName }));
      const corrections = await reclaimStaleInstrumentMappings(staleMappingCandidates);
      return { candidates: staleMappingCandidates.length, corrected: corrections.length };
    }, (r) => ({ summary: `${r.corrected} of ${r.candidates} candidates corrected`, details: r }));

    // Best-effort, fully isolated from the equity pipeline above: the Gold/
    // Silver ETF tab's own daily NAV pull + quarterly AUM-baseline rollover
    // check. Entirely independent data source (TigZig/AMFI, not DHAN), so a
    // failure here can never affect equity computation, and vice versa.
    await runOpsStep(run, "runEtfIngestion", () => runEtfIngestion());

    // Best-effort, fully isolated from both the equity pipeline above and
    // runEtfIngestion: the MCX Gold/Silver reference rows' own daily price
    // pull. This DOES use DHAN (unlike the ETF ingestion above, which is
    // deliberately DHAN-free) -- if DHAN is unavailable, this just leaves
    // today's mcx_daily_price row unwritten and the reference rows show
    // "—" for that day, with zero effect on ETF NAV/AAUM ingestion.
    await runOpsStep(run, "runMcxIngestion", () => runMcxIngestion());

    // Best-effort, fully isolated: the AMC detail page's own listed-stock
    // share-price overlay (see amc_listed_stock). These ISINs are never
    // anyone's holding, so a failure here has zero effect on the equity/
    // ETF/MCX pipelines above, and vice versa.
    await runOpsStep(run, "runAmcStockIngestion", () => runAmcStockIngestion());

    // Best-effort, fully isolated: last month's industry SIP and equity net
    // flows from AMFI's own Monthly Note (PDF) and Monthly Report (XLS),
    // once it's the 8th or later and the month isn't stored yet -- a no-op
    // (one small read) every other day. SIP revisions AMFI makes to the
    // previous 6 months are applied too and show as a warning here.
    await runOpsStep(
      run,
      "runAmfiMonthlyFlowIngestion",
      () =>
        runAmfiMonthlyFlowIngestion({
          istDate: getIstDateString(),
          existing: getAllMonthlyFlows,
          upsert: (r) => upsertMonthlyFlow(r.monthEndDate, r.sipContributionsCr, r.equityNetFlowsCr),
        }),
      (r) => ({ summary: r.summary, details: { status: r.status, month: r.month, write: r.write, revisions: r.revisions } })
    );

    // Final marker the retry-only run checks: "fail" when DHAN was fully
    // unavailable (e.g. expired token at 16:05) so a later retry -- after the
    // token is refreshed -- re-captures the real close.
    run.rows.push({
      node: "run-complete",
      status: snapshot.dhanStatus === "unavailable" ? "fail" : run.rows.some((r) => r.status !== "ok") ? "warn" : "ok",
      summary: `mode=${mode}; ${run.rows.filter((r) => r.status === "fail").length} failed, ${run.rows.filter((r) => r.status === "warn").length} warned`,
      durationMs: Date.now() - runStarted,
    });
    await flushOpsRun(run);
    return NextResponse.json({ ok: true, amcsSnapshotted: snapshot.amcs.length });
  } catch (err) {
    run.rows.push({
      node: "run-complete",
      status: "fail",
      summary: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - runStarted,
    });
    await flushOpsRun(run);
    if (err instanceof NoDataImportedError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 200 });
    }
    console.error(err);
    return NextResponse.json({ ok: false, error: "Daily snapshot failed" }, { status: 500 });
  }
}
