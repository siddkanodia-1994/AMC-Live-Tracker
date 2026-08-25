import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, amcs, holdings, liveAumDailySnapshot } from "../db/schema";
import { isBankDebtOrRepo, isCashEquivalent } from "../excel/instrument-classification";
import { getCanonicalSnapshotDateBounds } from "./history";
import { resolveReportPeriodForDate } from "./report-period";
import type { AmcLiveAum, LiveAumSnapshot } from "./types";

/**
 * Industry-wide cash + liquid debt as of a historical date, reusing each
 * AMC's already-resolved reportPeriod (computeOverviewAsOf's own byAmcId
 * map) rather than a new per-AMC lookup. Grouped by distinct reportPeriod
 * (almost always 1, occasionally 2, never 52) so this is one or two batched
 * `holdings` queries, not a loop per AMC. No price/isin_daily_price join
 * needed -- cash/debt line items are never DHAN-priceable, so their live
 * value already equals their reported marketValueCr in practice (same
 * reasoning AmcLiveAum.cashEquivalentCr/bankDebtRepoCr's own doc comment
 * already relies on for the live path).
 */
async function getIndustryCashDebtAsOf(amcReportPeriods: Map<number, string>): Promise<number> {
  const amcIdsByPeriod = new Map<string, number[]>();
  for (const [amcId, reportPeriod] of amcReportPeriods) {
    const list = amcIdsByPeriod.get(reportPeriod);
    if (list) list.push(amcId);
    else amcIdsByPeriod.set(reportPeriod, [amcId]);
  }

  const rowsPerPeriod = await Promise.all(
    [...amcIdsByPeriod.entries()].map(([reportPeriod, amcIds]) =>
      db
        .select({ sector: holdings.sector, companyName: holdings.companyName, marketValueCr: holdings.marketValueCr })
        .from(holdings)
        .where(and(inArray(holdings.amcId, amcIds), eq(holdings.reportPeriod, reportPeriod)))
    )
  );

  // Two independent checks summed separately (not a combined OR) to mirror
  // compute-live-aum.ts's own two-separate-`if`-statements shape exactly --
  // a holding matching both classifications counts in both there too.
  let total = 0;
  for (const rows of rowsPerPeriod) {
    for (const h of rows) {
      const marketValueCr = Number(h.marketValueCr);
      if (isBankDebtOrRepo(h.sector, h.companyName)) total += marketValueCr;
      if (isCashEquivalent(h.companyName)) total += marketValueCr;
    }
  }
  return total;
}

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

  // Which report period owns this date, per AMC -- resolved from each
  // AMC's own forward-gap windows (resolveReportPeriodForDate), not from
  // "whatever the nearest existing snapshot row says". The two used to
  // agree everywhere except a non-trading date sitting between an old
  // period's last trading day and a new period's first one (e.g. a weekend
  // right after a new month's file is uploaded), where the snapshot-row
  // approach would incorrectly reach back into the OLD period. This is a
  // small, bounded query (one row per AMC per calendar month since launch),
  // nothing like scanning liveAumDailySnapshot itself.
  const [periodRows, amcRows] = await Promise.all([
    db.select({ amcId: amcPeriods.amcId, reportPeriod: amcPeriods.reportPeriod }).from(amcPeriods),
    db.select({ id: amcs.id, slug: amcs.slug, overviewName: amcs.overviewName }).from(amcs),
  ]);

  const periodsByAmc = new Map<number, string[]>();
  for (const r of periodRows) {
    const list = periodsByAmc.get(r.amcId) ?? [];
    list.push(r.reportPeriod);
    periodsByAmc.set(r.amcId, list);
  }
  const resolvedPeriodByAmc = new Map<number, string>();
  for (const [amcId, periods] of periodsByAmc) {
    periods.sort();
    const resolved = resolveReportPeriodForDate(periods, asOfDate);
    if (resolved) resolvedPeriodByAmc.set(amcId, resolved);
  }

  // Group AMCs by their resolved period (almost always a single group --
  // divergence only happens for an AMC missing from the very latest
  // month's file) so each period's own snapshot rows are fetched with one
  // query scoped to just that period's own AMCs and its own forward-gap
  // window (bounded to roughly one month of trading days), mirroring
  // getIndustryCashDebtAsOf's existing per-period grouping below.
  const amcIdsByPeriod = new Map<string, number[]>();
  for (const [amcId, period] of resolvedPeriodByAmc) {
    const list = amcIdsByPeriod.get(period) ?? [];
    list.push(amcId);
    amcIdsByPeriod.set(period, list);
  }

  const snapshotRowsPerGroup = await Promise.all(
    [...amcIdsByPeriod.entries()].map(([period, amcIds]) =>
      db
        .select({
          amcId: liveAumDailySnapshot.amcId,
          snapshotDate: liveAumDailySnapshot.snapshotDate,
          liveAumCr: liveAumDailySnapshot.liveAumCr,
          reportedAumCr: liveAumDailySnapshot.reportedAumCr,
        })
        .from(liveAumDailySnapshot)
        .where(
          and(
            inArray(liveAumDailySnapshot.amcId, amcIds),
            eq(liveAumDailySnapshot.reportPeriod, period),
            eq(liveAumDailySnapshot.isCanonical, true)
          )
        )
    )
  );

  interface AsOfValues {
    liveAumCr: number;
    reportedAumCr: number;
    reportPeriod: string;
    snapshotDate: string;
    prevLiveAumCr: number | null;
  }
  const byAmcId = new Map<number, AsOfValues>();
  for (const groupRows of snapshotRowsPerGroup) {
    const rowsByAmc = new Map<number, { snapshotDate: string; liveAumCr: number; reportedAumCr: number }[]>();
    for (const r of groupRows) {
      const list = rowsByAmc.get(r.amcId) ?? [];
      list.push({ snapshotDate: r.snapshotDate, liveAumCr: Number(r.liveAumCr), reportedAumCr: Number(r.reportedAumCr) });
      rowsByAmc.set(r.amcId, list);
    }
    for (const [amcId, rows] of rowsByAmc) {
      // Newest first. Prefer the latest row on-or-before asOfDate; if the
      // resolved period has no data yet at or before this date (a
      // non-trading day sitting before that period's first actual trading
      // day), fall forward to the period's own earliest row instead of
      // reaching into a different period.
      rows.sort((a, b) => (a.snapshotDate < b.snapshotDate ? 1 : a.snapshotDate > b.snapshotDate ? -1 : 0));
      const onOrBeforeIndex = rows.findIndex((r) => r.snapshotDate <= asOfDate);
      const chosenIndex = onOrBeforeIndex !== -1 ? onOrBeforeIndex : rows.length - 1;
      const chosen = rows[chosenIndex];
      const prev = rows[chosenIndex + 1] ?? null;
      byAmcId.set(amcId, {
        liveAumCr: chosen.liveAumCr,
        reportedAumCr: chosen.reportedAumCr,
        reportPeriod: resolvedPeriodByAmc.get(amcId)!,
        snapshotDate: chosen.snapshotDate,
        prevLiveAumCr: prev ? prev.liveAumCr : null,
      });
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

  const amcReportPeriods = new Map([...byAmcId].map(([amcId, s]) => [amcId, s.reportPeriod]));
  const industryCashDebtCr = await getIndustryCashDebtAsOf(amcReportPeriods);

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
    industryCashDebtCr,
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
