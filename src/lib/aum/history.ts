import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, isinDailyPrice, liveAumDailySnapshot } from "../db/schema";
import { getIstDateString } from "../utils/date";
import { firstDayOfNextMonth, lastDayOfReportMonth } from "./report-period";

/**
 * Each AMC's reported AUM for one arbitrary (possibly past) report period --
 * amc_periods retains every imported month, never just the current one, so
 * this works for any period getAvailableReportPeriods() lists. Used by the
 * Overview table's Reported AUM month picker.
 */
export async function getReportedAumForPeriod(reportPeriod: string): Promise<Map<number, number>> {
  const rows = await db
    .select({ amcId: amcPeriods.amcId, reportedAumCr: amcPeriods.reportedAumCr })
    .from(amcPeriods)
    .where(eq(amcPeriods.reportPeriod, reportPeriod));

  const map = new Map<number, number>();
  for (const r of rows) {
    map.set(r.amcId, Number(r.reportedAumCr));
  }
  return map;
}

/**
 * Average of daily live-AUM snapshots over an arbitrary [startDate, endDate]
 * window -- the general form getAverageAumSinceReport (below) delegates to
 * with its own hardcoded window, and what the Overview table's Avg AUM
 * date-range picker calls directly for a custom window.
 */
export async function getAverageAumForRange(
  startDate: string,
  endDate: string
): Promise<Map<number, { avgLiveAumCr: number; daysCount: number }>> {
  const rows = await db
    .select({
      amcId: liveAumDailySnapshot.amcId,
      avgLiveAumCr: sql<number>`avg(${liveAumDailySnapshot.liveAumCr})::float`,
      daysCount: sql<number>`count(*)::int`,
    })
    .from(liveAumDailySnapshot)
    .where(
      and(
        gte(liveAumDailySnapshot.snapshotDate, startDate),
        lte(liveAumDailySnapshot.snapshotDate, endDate),
        eq(liveAumDailySnapshot.isCanonical, true)
      )
    )
    .groupBy(liveAumDailySnapshot.amcId);

  const map = new Map<number, { avgLiveAumCr: number; daysCount: number }>();
  for (const r of rows) {
    map.set(r.amcId, { avgLiveAumCr: r.avgLiveAumCr, daysCount: r.daysCount });
  }
  return map;
}

export interface AumHistoryPoint {
  date: string;
  liveAumCr: number;
  reportedAumCr: number;
  // Which report period reportedAumCr reflects on this date -- lets the
  // trend chart's tooltip show e.g. "(May 2026)" next to the Reported AUM
  // value, since that line only steps when a new month is imported.
  reportPeriod: string;
}

export async function getAmcAumHistory(amcId: number): Promise<AumHistoryPoint[]> {
  const rows = await db
    .select()
    .from(liveAumDailySnapshot)
    .where(and(eq(liveAumDailySnapshot.amcId, amcId), eq(liveAumDailySnapshot.isCanonical, true)))
    .orderBy(asc(liveAumDailySnapshot.snapshotDate));

  return rows.map((r) => ({
    date: r.snapshotDate,
    liveAumCr: Number(r.liveAumCr),
    reportedAumCr: Number(r.reportedAumCr),
    reportPeriod: r.reportPeriod,
  }));
}

export interface AverageAumSinceReport {
  avgLiveAumCr: number;
  daysCount: number;
  windowStart: string;
}

/**
 * Average of daily live-AUM snapshots since the window opened by the current
 * report period (1st of the month after it) through however many days have
 * actually been captured so far — the "avg AUM this period" column. Keyed by
 * amcId; AMCs with zero snapshots in the window are simply absent from the map.
 */
export async function getAverageAumSinceReport(reportPeriod: string): Promise<Map<number, AverageAumSinceReport>> {
  const windowStart = firstDayOfNextMonth(reportPeriod);
  const ranged = await getAverageAumForRange(windowStart, getIstDateString());

  const map = new Map<number, AverageAumSinceReport>();
  for (const [amcId, v] of ranged) {
    map.set(amcId, { ...v, windowStart });
  }
  return map;
}

export interface PreviousDayAum {
  liveAumCr: number;
  snapshotDate: string;
}

/**
 * Each AMC's most recent snapshot strictly before today (IST), regardless of
 * how many days back that is — used for the "1 Day Change %" column. A gap
 * in daily collection just means the comparison silently spans more than one
 * day rather than being blank; AMCs with no snapshot at all are absent from
 * the map.
 */
export async function getPreviousDayLiveAum(): Promise<Map<number, PreviousDayAum>> {
  const today = getIstDateString();

  // DISTINCT ON pushes the "keep only the newest row per AMC" dedup into
  // Postgres, so the app only ever receives one row per AMC instead of every
  // historical snapshot ever written for it (previously fetched the ENTIRE
  // table on every 45s poll -- see the egress-quota incident this fixes).
  const rows = await db
    .selectDistinctOn([liveAumDailySnapshot.amcId], {
      amcId: liveAumDailySnapshot.amcId,
      snapshotDate: liveAumDailySnapshot.snapshotDate,
      liveAumCr: liveAumDailySnapshot.liveAumCr,
    })
    .from(liveAumDailySnapshot)
    .where(and(lt(liveAumDailySnapshot.snapshotDate, today), eq(liveAumDailySnapshot.isCanonical, true)))
    .orderBy(liveAumDailySnapshot.amcId, desc(liveAumDailySnapshot.snapshotDate));

  const map = new Map<number, PreviousDayAum>();
  for (const r of rows) {
    map.set(r.amcId, { liveAumCr: Number(r.liveAumCr), snapshotDate: r.snapshotDate });
  }
  return map;
}

export interface LiveAumAsOf {
  liveAumCr: number;
  snapshotDate: string;
}

/**
 * Each AMC's most recent canonical snapshot on or before an arbitrary date --
 * the batched, date-parameterized sibling of getPreviousDayLiveAum, used by
 * the Total AUM Growth tab's calendar-picked Live AUM column. AMCs with no
 * canonical snapshot on or before the date are simply absent from the map.
 */
export async function getAllAmcsLiveAumAsOf(date: string): Promise<Map<number, LiveAumAsOf>> {
  // Same DISTINCT ON dedup-in-Postgres fix as getPreviousDayLiveAum above.
  const rows = await db
    .selectDistinctOn([liveAumDailySnapshot.amcId], {
      amcId: liveAumDailySnapshot.amcId,
      snapshotDate: liveAumDailySnapshot.snapshotDate,
      liveAumCr: liveAumDailySnapshot.liveAumCr,
    })
    .from(liveAumDailySnapshot)
    .where(and(lte(liveAumDailySnapshot.snapshotDate, date), eq(liveAumDailySnapshot.isCanonical, true)))
    .orderBy(liveAumDailySnapshot.amcId, desc(liveAumDailySnapshot.snapshotDate));

  const map = new Map<number, LiveAumAsOf>();
  for (const r of rows) {
    map.set(r.amcId, { liveAumCr: Number(r.liveAumCr), snapshotDate: r.snapshotDate });
  }
  return map;
}

/**
 * Earliest and latest canonical snapshot dates across the whole app -- bounds
 * the Total AUM Growth tab's calendar picker, mirroring how the AUM Growth
 * tab bounds its own picker per report period.
 */
export async function getCanonicalSnapshotDateBounds(): Promise<{ minDate: string | null; maxDate: string | null }> {
  const [row] = await db
    .select({
      minDate: sql<string | null>`min(${liveAumDailySnapshot.snapshotDate})`,
      maxDate: sql<string | null>`max(${liveAumDailySnapshot.snapshotDate})`,
    })
    .from(liveAumDailySnapshot)
    .where(eq(liveAumDailySnapshot.isCanonical, true));
  return { minDate: row?.minDate ?? null, maxDate: row?.maxDate ?? null };
}

/**
 * Each priced ISIN's most recent stored price strictly before today (IST) —
 * the per-holding sibling of getPreviousDayLiveAum, keyed by ISIN rather than
 * amcId since price is a security-level fact shared across every AMC holding
 * it (one row instead of one per AMC). Same "most recent regardless of gap"
 * semantics; ISINs never priced before are simply absent from the map.
 */
export async function getPreviousDayIsinPrices(): Promise<Map<string, number>> {
  const today = getIstDateString();

  // DISTINCT ON (isin) -- this table grows by ~one row per priceable ISIN
  // per trading day forever; the old fetch-everything-then-dedupe-in-JS
  // query was re-downloading the WHOLE table on every 45s poll and was the
  // single largest contributor to the Neon egress-quota exhaustion this
  // fixes. Now Postgres returns exactly one row per ISIN.
  const rows = await db
    .selectDistinctOn([isinDailyPrice.isin], {
      isin: isinDailyPrice.isin,
      priceInr: isinDailyPrice.priceInr,
    })
    .from(isinDailyPrice)
    .where(lt(isinDailyPrice.snapshotDate, today))
    .orderBy(isinDailyPrice.isin, desc(isinDailyPrice.snapshotDate));

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.isin, Number(r.priceInr));
  }
  return map;
}

export interface NetFlowEstimate {
  netFlowCr: number;
  netFlowPct: number | null;
  priorPeriod: string;
  priorPeriodReportedAumCr: number;
  baselineCr: number;
  monthEndDate: string;
}

/**
 * Estimated net flow for a report period: how much of the period's reported
 * AUM is NOT explained by price movement of the prior period's holdings.
 * baselineCr is what AUM would be on the current period's month-end if the
 * prior period's holdings had simply been repriced day by day (no trading,
 * no subscriptions/redemptions) — sourced from live_aum_daily_snapshot rows
 * tagged with the PRIOR reportPeriod (see backfillDailySnapshots' reportPeriod
 * override). netFlowCr = currentPeriod.reportedAumCr - baselineCr.
 *
 * netFlowPct divides that same Cr amount by the PRIOR period's reported AUM
 * (not baselineCr) — matching getAumGrowthComparison's "Net Flow %" exactly,
 * so the two don't show different percentages for an identical flow amount.
 *
 * This conflates genuine investor subscriptions/redemptions with the fund
 * manager's own trading activity (new buys, full exits, rebalancing) — it is
 * an approximation, not a pure "flows" figure. Generic over any two adjacent
 * periods; automatically extends to future months as they're imported.
 *
 * Keyed by amcId; an AMC is absent from the map when there's no prior period
 * at all, or no backfilled month-end snapshot yet for that AMC.
 */
export async function getNetFlowForPeriod(reportPeriod: string): Promise<Map<number, NetFlowEstimate>> {
  const map = new Map<number, NetFlowEstimate>();

  // Each AMC's OWN most recent period strictly before reportPeriod — not one
  // globally-resolved prior period. A partial backfill that introduces a
  // brand-new earliest period for a single AMC must never shift every other
  // AMC's comparison baseline (and silently blank their net flow).
  const priorPeriodRows = await db
    .select({ amcId: amcPeriods.amcId, priorPeriod: sql<string>`max(${amcPeriods.reportPeriod})` })
    .from(amcPeriods)
    .where(lt(amcPeriods.reportPeriod, reportPeriod))
    .groupBy(amcPeriods.amcId);
  if (priorPeriodRows.length === 0) return map;
  const priorPeriodByAmcId = new Map(priorPeriodRows.map((r) => [r.amcId, r.priorPeriod]));
  const distinctPriorPeriods = [...new Set(priorPeriodRows.map((r) => r.priorPeriod))];

  const monthEndDate = lastDayOfReportMonth(reportPeriod);

  const [currentPeriods, priorPeriodReported, baselineSnapshots] = await Promise.all([
    db
      .select({ amcId: amcPeriods.amcId, reportedAumCr: amcPeriods.reportedAumCr })
      .from(amcPeriods)
      .where(eq(amcPeriods.reportPeriod, reportPeriod)),
    db
      .select({ amcId: amcPeriods.amcId, reportPeriod: amcPeriods.reportPeriod, reportedAumCr: amcPeriods.reportedAumCr })
      .from(amcPeriods)
      .where(inArray(amcPeriods.reportPeriod, distinctPriorPeriods)),
    // <=, not =: the literal calendar month-end is frequently a weekend or
    // holiday with no snapshot row (e.g. May 2026 ends on a Sunday) — take
    // the most recent trading day's snapshot on or before it instead, same
    // "most recent regardless of gap" approach as getPreviousDayLiveAum.
    // DISTINCT ON (amcId, reportPeriod) -- same dedup-in-Postgres fix as
    // above, applied to the (amcId, reportPeriod) grouping this query needs
    // instead of just amcId.
    db
      .selectDistinctOn([liveAumDailySnapshot.amcId, liveAumDailySnapshot.reportPeriod], {
        amcId: liveAumDailySnapshot.amcId,
        snapshotDate: liveAumDailySnapshot.snapshotDate,
        reportPeriod: liveAumDailySnapshot.reportPeriod,
        liveAumCr: liveAumDailySnapshot.liveAumCr,
      })
      .from(liveAumDailySnapshot)
      .where(
        and(
          inArray(liveAumDailySnapshot.reportPeriod, distinctPriorPeriods),
          lte(liveAumDailySnapshot.snapshotDate, monthEndDate)
        )
      )
      .orderBy(liveAumDailySnapshot.amcId, liveAumDailySnapshot.reportPeriod, desc(liveAumDailySnapshot.snapshotDate)),
  ]);

  // Baseline and prior-reported figures only count when they belong to the
  // AMC's own prior period — rows from some other AMC's prior period are
  // skipped rather than silently mixed in.
  const baselineByAmcId = new Map<number, number>();
  for (const r of baselineSnapshots) {
    if (r.reportPeriod !== priorPeriodByAmcId.get(r.amcId)) continue;
    baselineByAmcId.set(r.amcId, Number(r.liveAumCr));
  }
  const priorReportedByAmcId = new Map<number, number>();
  for (const r of priorPeriodReported) {
    if (r.reportPeriod === priorPeriodByAmcId.get(r.amcId)) {
      priorReportedByAmcId.set(r.amcId, Number(r.reportedAumCr));
    }
  }

  for (const cur of currentPeriods) {
    const priorPeriod = priorPeriodByAmcId.get(cur.amcId);
    if (!priorPeriod) continue;
    const baselineCr = baselineByAmcId.get(cur.amcId);
    if (baselineCr === undefined) continue;
    const priorPeriodReportedAumCr = priorReportedByAmcId.get(cur.amcId);
    if (priorPeriodReportedAumCr === undefined) continue;
    const reportedAumCr = Number(cur.reportedAumCr);
    const netFlowCr = reportedAumCr - baselineCr;
    const netFlowPct = priorPeriodReportedAumCr !== 0 ? netFlowCr / priorPeriodReportedAumCr : null;
    map.set(cur.amcId, { netFlowCr, netFlowPct, priorPeriod, priorPeriodReportedAumCr, baselineCr, monthEndDate });
  }

  return map;
}

export async function getIndustryAumHistory(): Promise<AumHistoryPoint[]> {
  const rows = await db
    .select({
      date: liveAumDailySnapshot.snapshotDate,
      liveAumCr: sql<number>`sum(${liveAumDailySnapshot.liveAumCr})::float`,
      reportedAumCr: sql<number>`sum(${liveAumDailySnapshot.reportedAumCr})::float`,
      // Canonical rows for a given date all share one reportPeriod in
      // practice (the whole industry moves to a new "current" period
      // together) -- max() is just a safe way to pick the one value out of
      // the group-by without a second query.
      reportPeriod: sql<string>`max(${liveAumDailySnapshot.reportPeriod})`,
    })
    .from(liveAumDailySnapshot)
    .where(eq(liveAumDailySnapshot.isCanonical, true))
    .groupBy(liveAumDailySnapshot.snapshotDate)
    .orderBy(asc(liveAumDailySnapshot.snapshotDate));

  return rows;
}
