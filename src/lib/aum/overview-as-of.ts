import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { amcs, liveAumDailySnapshot } from "../db/schema";
import { getCanonicalSnapshotDateBounds } from "./history";
import type { AmcLiveAum, LiveAumSnapshot } from "./types";

/**
 * The Overview repriced to an arbitrary historical date, sourced entirely
 * from canonical daily snapshots rather than live DHAN quotes. Only the
 * snapshot-derivable columns are populated: Live AUM (each AMC's canonical
 * snapshot on or before the date), 1D Change (vs. the snapshot immediately
 * before that one), and Live vs Reported (against the reported AUM the
 * snapshot itself was computed from, so an old date compares against the
 * report period that was current back then). Everything only meaningful
 * "today" — Avg AUM, Est. Net Flow, holdings/priced counts — is nulled or
 * zeroed, and the Overview renders those columns as "—" in historical mode.
 */
export async function computeOverviewAsOf(
  requestedDate: string
): Promise<LiveAumSnapshot & { asOfDate: string; minSnapshotDate: string; maxSnapshotDate: string }> {
  const { minDate, maxDate } = await getCanonicalSnapshotDateBounds();
  if (!minDate || !maxDate) {
    throw new Error("No live AUM history has been captured yet — the daily snapshot cron hasn't run.");
  }
  const asOfDate = requestedDate < minDate ? minDate : requestedDate > maxDate ? maxDate : requestedDate;

  // Need only the newest TWO canonical rows per AMC (as-of value + the prior
  // day for 1D change) -- a row_number() window function bounds what
  // Postgres sends back to exactly 2 rows/AMC, instead of the old
  // fetch-every-snapshot-ever-and-dedupe-in-JS query (unbounded, grows every
  // trading day forever -- a top contributor to the Neon egress-quota
  // exhaustion this fixes).
  const ranked = db.$with("ranked_snapshots").as(
    db
      .select({
        amcId: liveAumDailySnapshot.amcId,
        snapshotDate: liveAumDailySnapshot.snapshotDate,
        liveAumCr: liveAumDailySnapshot.liveAumCr,
        reportedAumCr: liveAumDailySnapshot.reportedAumCr,
        reportPeriod: liveAumDailySnapshot.reportPeriod,
        rn: sql<number>`row_number() over (partition by ${liveAumDailySnapshot.amcId} order by ${liveAumDailySnapshot.snapshotDate} desc)`.as(
          "rn"
        ),
      })
      .from(liveAumDailySnapshot)
      .where(and(lte(liveAumDailySnapshot.snapshotDate, asOfDate), eq(liveAumDailySnapshot.isCanonical, true)))
  );

  const [snapshotRows, amcRows] = await Promise.all([
    db
      .with(ranked)
      .select()
      .from(ranked)
      .where(sql`${ranked.rn} <= 2`)
      .orderBy(ranked.amcId, desc(ranked.snapshotDate)),
    db.select({ id: amcs.id, slug: amcs.slug, overviewName: amcs.overviewName }).from(amcs),
  ]);

  // Rows are ordered newest-first and canonical rows are unique per
  // (amcId, snapshotDate), so per AMC the first row seen is its as-of value
  // and the next one is the prior day's — same walk as getPreviousDayLiveAum.
  interface AsOfValues {
    liveAumCr: number;
    reportedAumCr: number;
    reportPeriod: string;
    snapshotDate: string;
    prevLiveAumCr: number | null;
  }
  const byAmcId = new Map<number, AsOfValues>();
  for (const r of snapshotRows) {
    const existing = byAmcId.get(r.amcId);
    if (!existing) {
      byAmcId.set(r.amcId, {
        liveAumCr: Number(r.liveAumCr),
        reportedAumCr: Number(r.reportedAumCr),
        reportPeriod: r.reportPeriod,
        snapshotDate: r.snapshotDate,
        prevLiveAumCr: null,
      });
    } else if (existing.prevLiveAumCr === null && r.snapshotDate < existing.snapshotDate) {
      existing.prevLiveAumCr = Number(r.liveAumCr);
    }
  }

  const amcById = new Map(amcRows.map((a) => [a.id, a]));
  const rows: AmcLiveAum[] = [];
  for (const [amcId, s] of byAmcId) {
    const amc = amcById.get(amcId);
    if (!amc) continue;
    const deltaCr = s.liveAumCr - s.reportedAumCr;
    rows.push({
      amcId,
      slug: amc.slug,
      overviewName: amc.overviewName,
      reportPeriod: s.reportPeriod,
      reportedAumCr: s.reportedAumCr,
      liveAumCr: s.liveAumCr,
      deltaCr,
      deltaPct: s.reportedAumCr !== 0 ? deltaCr / s.reportedAumCr : 0,
      residualPlugCr: 0,
      holdingsCount: 0,
      debtInstrumentCount: 0,
      livePricedCount: 0,
      stalePricedCount: 0,
      distinctHoldingIsins: [],
      distinctDebtKeys: [],
      distinctLivePricedIsins: [],
      cashEquivalentCr: 0,
      bankDebtRepoCr: 0,
      avgLiveAumCr: null,
      avgVsReportedPct: null,
      avgWindowDays: 0,
      avgLiveAumCr90d: null,
      avgLiveAumCrPrev90d: null,
      previousDayLiveAumCr: s.prevLiveAumCr,
      oneDayChangePct: s.prevLiveAumCr !== null && s.prevLiveAumCr !== 0 ? s.liveAumCr / s.prevLiveAumCr - 1 : null,
      netFlowCr: null,
      netFlowPct: null,
      netFlowPriorPeriod: null,
      netFlowPriorPeriodReportedAumCr: null,
      netFlowBaselineCr: null,
    });
  }
  rows.sort((a, b) => b.liveAumCr - a.liveAumCr);

  const totalLiveAumCr = rows.reduce((sum, r) => sum + r.liveAumCr, 0);
  const totalReportedAumCr = rows.reduce((sum, r) => sum + r.reportedAumCr, 0);
  // The label period: whichever report period the as-of snapshots were most
  // recently based on (they can briefly differ across AMCs right after an
  // import — take the latest).
  const reportPeriod = rows.reduce((max, r) => (r.reportPeriod > max ? r.reportPeriod : max), rows[0]?.reportPeriod ?? "");

  return {
    amcs: rows,
    totalLiveAumCr,
    totalReportedAumCr,
    reportPeriod,
    computedAt: new Date().toISOString(),
    dhanStatus: "ok",
    dhanErrorDetail: null,
    distinctHoldingsCount: 0,
    distinctDebtInstrumentCount: 0,
    distinctLivePricedCount: 0,
    distinctLastCloseCount: 0,
    lastCloseStocks: [],
    lastCloseDismissedToday: false,
    priceAsOfDate: asOfDate,
    pricesAreLive: false,
    asOfDate,
    minSnapshotDate: minDate,
    maxSnapshotDate: maxDate,
  };
}
