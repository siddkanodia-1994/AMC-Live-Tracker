import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { amcHistoricalAumEstimate, amcManualNetFlow, amcPeriods, amcs, isinDailyPrice, liveAumDailySnapshot } from "../db/schema";
import { addDaysToDateString, getIstDateString } from "../utils/date";
import { firstDayOfNextMonth, lastDayOfReportMonth, nextReportPeriod } from "./report-period";
import { getEtfDailyAumByAmcIds } from "../etf/average-aum";

/**
 * Adds each AMC's combined Gold+Silver daily AUM (where it exists) onto
 * the matching date's liveAumCr, in place, for whichever amcIds are in
 * `blendAmcIds` -- the "blend Gold/Silver into Equity AUM" toggle's one
 * shared primitive, reused by every AUM-history reader below. A day with
 * no Gold/Silver data for that AMC is left untouched (+0, equity-only
 * fallback), never treated as missing/an error -- confirmed user decision.
 */
async function blendGoldSilverIntoHistory(
  pointsByAmcId: Map<number, { date: string; liveAumCr: number }[]>,
  blendAmcIds: number[]
): Promise<void> {
  if (blendAmcIds.length === 0) return;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  for (const amcId of blendAmcIds) {
    for (const p of pointsByAmcId.get(amcId) ?? []) {
      if (minDate === null || p.date < minDate) minDate = p.date;
      if (maxDate === null || p.date > maxDate) maxDate = p.date;
    }
  }
  if (minDate === null || maxDate === null) return;

  const goldSilverByAmcId = await getEtfDailyAumByAmcIds(blendAmcIds, minDate, maxDate);
  for (const amcId of blendAmcIds) {
    const goldSilverByDate = goldSilverByAmcId.get(amcId);
    if (!goldSilverByDate) continue;
    for (const p of pointsByAmcId.get(amcId) ?? []) {
      const extra = goldSilverByDate.get(p.date);
      if (extra != null) p.liveAumCr += extra;
    }
  }
}

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

// Whether `dateStr` falls in the "extra lag" window this estimate exists to
// patch, and if so, the flat amount to add -- the SAME amount every
// qualifying day, never scaled by how far into the gap it is. That window
// opens a full calendar month after the current report period's own
// month-end, not the day right after it: e.g. current report period =
// August -> September is a normal, fully-expected "still using last
// month's holdings" month (no adjustment at all, regardless of the
// toggle), and the gap only opens on October 1 -- because by October 1 a
// whole month (September) has fully closed in reality without its own
// file having arrived yet, which is specifically the ~15-20 day lag this
// patches. That boundary is deliberately the exact same date
// reclaimForwardGap() will later recompute from once the awaited file
// lands (firstDayOfNextMonth of the NEW period), so the patch covers
// precisely the days that eventually get overwritten with real data and
// require no separate "turn it off" step. This is the one place the
// formula is written; compute-live-aum.ts's point-in-time estimate and
// getAverageAumForRange below both call it, so neither can drift out of
// sync with the other.
export function flowAdjustmentForDate(dateStr: string, netFlowCr: number, reportPeriod: string): number | null {
  const gapStartDate = firstDayOfNextMonth(nextReportPeriod(reportPeriod));
  return dateStr < gapStartDate ? null : netFlowCr;
}

export interface FlowAdjustmentContext {
  reportPeriod: string;
  netFlowCrByAmcId: Map<number, number>;
}

/**
 * Everything flowAdjustmentForDate needs for "the current report period",
 * built once per request and threaded into getAverageAumForRange wherever a
 * window's own end date can reach into the still-open gap. A fresh
 * getEffectiveNetFlowForPeriod query (calculated net flow with any
 * amc_listed_stock manual overrides applied), independent of whatever
 * single netFlows map a caller may already hold -- kept this way so
 * getRolling90DayAverages/getOverviewAdjustments don't have to restructure
 * their own already-parallel Promise.all just to share one.
 */
export async function getFlowAdjustmentContext(reportPeriod: string): Promise<FlowAdjustmentContext> {
  const netFlows = await getEffectiveNetFlowForPeriod(reportPeriod);
  return {
    reportPeriod,
    netFlowCrByAmcId: new Map([...netFlows].map(([amcId, nf]) => [amcId, nf.netFlowCr])),
  };
}

export interface AverageAumRange {
  avgLiveAumCr: number;
  // avgLiveAumCr plus a single flat flowAdjustmentForDate add-on, gated on
  // whether THIS WINDOW'S OWN endDate reaches into the still-open gap --
  // not a per-day proration, so a longer window doesn't dilute it and a
  // window that ends before the gap opens gets no adjustment at all. null
  // only when this AMC has no net-flow estimate at all yet (e.g. a
  // brand-new AMC with no prior period) -- callers fall back to
  // avgLiveAumCr, same convention as AmcLiveAum.flowAdjustedLiveAumCr.
  // Always null when no FlowAdjustmentContext was passed in (the common
  // case -- most callers don't need this).
  avgFlowAdjustedLiveAumCr: number | null;
  daysCount: number;
}

/**
 * Average of daily live-AUM snapshots over an arbitrary [startDate, endDate]
 * window -- the general form getAverageAumSinceReport (below) delegates to
 * with its own hardcoded window, and what the Overview table's Avg AUM
 * date-range picker calls directly for a custom window. A single SQL
 * AVG()/COUNT() aggregate regardless of whether a FlowAdjustmentContext is
 * passed -- the flow adjustment is a flat, once-per-window add-on (not a
 * per-day proration), so it never needs raw per-day rows to compute.
 */
export async function getAverageAumForRange(
  startDate: string,
  endDate: string,
  flowCtx?: FlowAdjustmentContext,
  blendGoldSilverAmcIds?: number[]
): Promise<Map<number, AverageAumRange>> {
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

  const map = new Map<number, AverageAumRange>();
  for (const r of rows) {
    let avgFlowAdjustedLiveAumCr: number | null = null;
    const netFlowCr = flowCtx?.netFlowCrByAmcId.get(r.amcId);
    if (netFlowCr !== undefined) {
      const adjustment = flowAdjustmentForDate(endDate, netFlowCr, flowCtx!.reportPeriod);
      avgFlowAdjustedLiveAumCr = adjustment === null ? r.avgLiveAumCr : r.avgLiveAumCr + adjustment;
    }
    map.set(r.amcId, { avgLiveAumCr: r.avgLiveAumCr, avgFlowAdjustedLiveAumCr, daysCount: r.daysCount });
  }

  // Blended AMCs need the TRUE day-by-day sum averaged (not two separate
  // averages added together, which would only be exact if the equity and
  // Gold/Silver series shared the identical set of dates) -- so these are
  // recomputed from raw per-day rows instead of the SQL aggregate above.
  const toBlend = (blendGoldSilverAmcIds ?? []).filter((id) => map.has(id));
  if (toBlend.length > 0) {
    const rawRows = await db
      .select({ amcId: liveAumDailySnapshot.amcId, snapshotDate: liveAumDailySnapshot.snapshotDate, liveAumCr: liveAumDailySnapshot.liveAumCr })
      .from(liveAumDailySnapshot)
      .where(
        and(
          inArray(liveAumDailySnapshot.amcId, toBlend),
          gte(liveAumDailySnapshot.snapshotDate, startDate),
          lte(liveAumDailySnapshot.snapshotDate, endDate),
          eq(liveAumDailySnapshot.isCanonical, true)
        )
      );
    const goldSilverByAmcId = await getEtfDailyAumByAmcIds(toBlend, startDate, endDate);

    const sums = new Map<number, number>();
    const counts = new Map<number, number>();
    for (const r of rawRows) {
      const extra = goldSilverByAmcId.get(r.amcId)?.get(r.snapshotDate) ?? 0;
      const blended = Number(r.liveAumCr) + extra;
      sums.set(r.amcId, (sums.get(r.amcId) ?? 0) + blended);
      counts.set(r.amcId, (counts.get(r.amcId) ?? 0) + 1);
    }
    for (const amcId of toBlend) {
      const count = counts.get(amcId);
      if (!count) continue;
      const avgLiveAumCr = sums.get(amcId)! / count;
      const existing = map.get(amcId)!;
      let avgFlowAdjustedLiveAumCr: number | null = null;
      const netFlowCr = flowCtx?.netFlowCrByAmcId.get(amcId);
      if (netFlowCr !== undefined) {
        const adjustment = flowAdjustmentForDate(endDate, netFlowCr, flowCtx!.reportPeriod);
        avgFlowAdjustedLiveAumCr = adjustment === null ? avgLiveAumCr : avgLiveAumCr + adjustment;
      }
      map.set(amcId, { avgLiveAumCr, avgFlowAdjustedLiveAumCr, daysCount: existing.daysCount });
    }
  }

  return map;
}

export interface AumHistoryPoint {
  date: string;
  liveAumCr: number;
  // null for the 2023-2025 historical-estimate stretch (see
  // getHistoricalAumEstimatePoints) -- there's no real monthly import
  // behind an estimated date, so the chart's Reported AUM line simply
  // isn't drawn there (Recharts leaves a gap wherever a Line's dataKey is
  // null); it only starts appearing once real 2026+ data begins.
  reportedAumCr: number | null;
  // Which report period reportedAumCr reflects on this date -- lets the
  // trend chart's tooltip show e.g. "(May 2026)" next to the Reported AUM
  // value, since that line only steps when a new month is imported. Empty
  // string for the historical-estimate stretch (reportedAumCr is null
  // there anyway, so this is never rendered).
  reportPeriod: string;
}

/**
 * amc_historical_aum_estimate rows for one AMC, shaped as AumHistoryPoint
 * so they can be prepended directly ahead of the real liveAumDailySnapshot
 * rows -- see historical-backfill.ts for how estimatedAumCr is computed.
 * Empty for any AMC with no estimate rows (i.e. every AMC except the 8
 * amc_listed_stock ones this backfill covers).
 */
async function getHistoricalAumEstimatePoints(amcId: number): Promise<AumHistoryPoint[]> {
  const rows = await db
    .select()
    .from(amcHistoricalAumEstimate)
    .where(eq(amcHistoricalAumEstimate.amcId, amcId))
    .orderBy(asc(amcHistoricalAumEstimate.snapshotDate));

  return rows.map((r) => ({
    date: r.snapshotDate,
    liveAumCr: Number(r.estimatedAumCr),
    reportedAumCr: null,
    reportPeriod: "",
  }));
}

export async function getAmcAumHistory(amcId: number, options?: { blendGoldSilver?: boolean }): Promise<AumHistoryPoint[]> {
  const rows = await db
    .select()
    .from(liveAumDailySnapshot)
    .where(and(eq(liveAumDailySnapshot.amcId, amcId), eq(liveAumDailySnapshot.isCanonical, true)))
    .orderBy(asc(liveAumDailySnapshot.snapshotDate));

  const liveHistory = rows.map((r) => ({
    date: r.snapshotDate,
    liveAumCr: Number(r.liveAumCr),
    reportedAumCr: Number(r.reportedAumCr) as number | null,
    reportPeriod: r.reportPeriod,
  }));
  const estimateHistory = await getHistoricalAumEstimatePoints(amcId);
  const combined = [...estimateHistory, ...liveHistory];

  if (options?.blendGoldSilver) {
    const byAmcId = new Map([[amcId, combined]]);
    await blendGoldSilverIntoHistory(byAmcId, [amcId]);
  }
  return combined;
}

export interface AmcStockPricePoint {
  date: string;
  priceInr: number;
}

/**
 * Daily closing price history for an AMC's OWN listed stock (see
 * amc_listed_stock / runAmcStockIngestion), from `fromDate` through
 * whatever's most recently stored -- feeds the AUM Trend chart's
 * optional share-price overlay. Plain read off isin_daily_price, same
 * table every other equity price already lives in (see the plan's audit
 * of amc-stock ingestion for why reusing it here is schema/logic-safe).
 */
export async function getAmcListedStockPriceHistory(isin: string, fromDate: string): Promise<AmcStockPricePoint[]> {
  const rows = await db
    .select()
    .from(isinDailyPrice)
    .where(and(eq(isinDailyPrice.isin, isin), gte(isinDailyPrice.snapshotDate, fromDate)))
    .orderBy(asc(isinDailyPrice.snapshotDate));

  return rows.map((r) => ({ date: r.snapshotDate, priceInr: Number(r.priceInr) }));
}

/**
 * Batched sibling of getAmcAumHistory for the Stock Correlation tab, which
 * needs all 8 listed-stock AMCs' history at once -- one query with
 * inArray(amcId) instead of 8 round trips. `fromDates` lets each AMC use
 * its own listed-stock backfillFromDate as a floor (skip pre-listing
 * history that has no share price to correlate against anyway); omit an
 * amcId from the map to fetch its whole history instead.
 */
export async function getAumHistoryForAmcIds(
  amcIds: number[],
  fromDates?: Map<number, string>,
  blendGoldSilverAmcIds?: number[]
): Promise<Map<number, AumHistoryPoint[]>> {
  const map = new Map<number, AumHistoryPoint[]>();
  if (amcIds.length === 0) return map;

  const estimateRows = await db
    .select()
    .from(amcHistoricalAumEstimate)
    .where(inArray(amcHistoricalAumEstimate.amcId, amcIds))
    .orderBy(asc(amcHistoricalAumEstimate.snapshotDate));
  for (const r of estimateRows) {
    const list = map.get(r.amcId) ?? [];
    list.push({ date: r.snapshotDate, liveAumCr: Number(r.estimatedAumCr), reportedAumCr: null, reportPeriod: "" });
    map.set(r.amcId, list);
  }

  const rows = await db
    .select()
    .from(liveAumDailySnapshot)
    .where(and(inArray(liveAumDailySnapshot.amcId, amcIds), eq(liveAumDailySnapshot.isCanonical, true)))
    .orderBy(asc(liveAumDailySnapshot.snapshotDate));

  for (const r of rows) {
    const floor = fromDates?.get(r.amcId);
    if (floor && r.snapshotDate < floor) continue;
    const list = map.get(r.amcId) ?? [];
    list.push({
      date: r.snapshotDate,
      liveAumCr: Number(r.liveAumCr),
      reportedAumCr: Number(r.reportedAumCr),
      reportPeriod: r.reportPeriod,
    });
    map.set(r.amcId, list);
  }

  if (blendGoldSilverAmcIds && blendGoldSilverAmcIds.length > 0) {
    await blendGoldSilverIntoHistory(map, blendGoldSilverAmcIds.filter((id) => amcIds.includes(id)));
  }
  return map;
}

/**
 * Batched sibling of getAmcListedStockPriceHistory -- all 8 listed-stock
 * AMCs' own share-price history in one inArray(isin) query instead of 8
 * separate calls. `fromDates` is keyed by ISIN, mirroring each row's own
 * amc_listed_stock.backfillFromDate.
 */
export async function getAmcListedStockPriceHistoryForIsins(
  isins: string[],
  fromDates: Map<string, string>
): Promise<Map<string, AmcStockPricePoint[]>> {
  const map = new Map<string, AmcStockPricePoint[]>();
  if (isins.length === 0) return map;

  const rows = await db
    .select()
    .from(isinDailyPrice)
    .where(inArray(isinDailyPrice.isin, isins))
    .orderBy(asc(isinDailyPrice.snapshotDate));

  for (const r of rows) {
    const floor = fromDates.get(r.isin);
    if (floor && r.snapshotDate < floor) continue;
    const list = map.get(r.isin) ?? [];
    list.push({ date: r.snapshotDate, priceInr: Number(r.priceInr) });
    map.set(r.isin, list);
  }
  return map;
}

export interface AverageAumSinceReport {
  avgLiveAumCr: number;
  avgFlowAdjustedLiveAumCr: number | null;
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

export interface Rolling90DayAverages {
  last90ByAmcId: Map<number, AverageAumRange>;
  prev90ByAmcId: Map<number, AverageAumRange>;
  last90Start: string;
  last90End: string;
  prev90Start: string;
  prev90End: string;
}

/**
 * Two fixed rolling calendar-day windows ending today: the last 90 days, and
 * the 90 days immediately before that -- used by the Overview page's
 * "Average Industry Equity AUM (last 90 days)" card, which (unlike Avg AUM/
 * Avg Live AUM) is a fixed calendar window rather than anchored to the
 * current report period or fiscal quarter. Both windows' start dates are
 * clamped to the earliest canonical snapshot on record, so this stays
 * well-defined even before 180 days of data exist.
 *
 * Only last90 gets flow-adjusted (it's the one that can include today/the
 * still-open period, and it's the one shown as the card's own headline
 * figure); prev90 stays pure MTM, same "comparison badge stays anchored to
 * the real series" precedent as the point-in-time headline card's delta
 * badge in amc-grid.tsx.
 */
export async function getRolling90DayAverages(reportPeriod: string): Promise<Rolling90DayAverages> {
  const today = getIstDateString();
  const { minDate } = await getCanonicalSnapshotDateBounds();

  let last90Start = addDaysToDateString(today, -89);
  let prev90Start = addDaysToDateString(today, -179);
  const prev90End = addDaysToDateString(today, -90);
  if (minDate) {
    if (last90Start < minDate) last90Start = minDate;
    if (prev90Start < minDate) prev90Start = minDate;
  }

  const flowCtx = await getFlowAdjustmentContext(reportPeriod);
  const [last90ByAmcId, prev90ByAmcId] = await Promise.all([
    getAverageAumForRange(last90Start, today, flowCtx),
    getAverageAumForRange(prev90Start, prev90End),
  ]);

  return { last90ByAmcId, prev90ByAmcId, last90Start, last90End: today, prev90Start, prev90End };
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

/**
 * Each priced ISIN's own price already recorded today (IST), if any -- the
 * fallback tier compute-live-aum.ts checks before falling back to
 * getPreviousDayIsinPrices' (yesterday's) price, so an off-hours
 * recomputation after today's close-capture cron reproduces today's actual
 * close instead of regressing to yesterday's. Exact-date match on the
 * unique (isin, snapshot_date) index -- at most one row per ISIN, no
 * DISTINCT ON needed.
 */
export async function getTodayIsinPrices(): Promise<Map<string, number>> {
  const today = getIstDateString();

  const rows = await db
    .select({ isin: isinDailyPrice.isin, priceInr: isinDailyPrice.priceInr })
    .from(isinDailyPrice)
    .where(eq(isinDailyPrice.snapshotDate, today));

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.isin, Number(r.priceInr));
  }
  return map;
}

/**
 * Date-parameterized sibling of getTodayIsinPrices, for split-detection.ts --
 * that module needs to compare an arbitrary date's close (not just "today"),
 * both for the daily cron's real-time run and for the retroactive admin
 * route that backfills an already-happened split.
 */
export async function getIsinPricesForDate(date: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ isin: isinDailyPrice.isin, priceInr: isinDailyPrice.priceInr })
    .from(isinDailyPrice)
    .where(eq(isinDailyPrice.snapshotDate, date));

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.isin, Number(r.priceInr));
  }
  return map;
}

/**
 * Date-parameterized sibling of getPreviousDayIsinPrices -- each priced
 * ISIN's most recent stored price strictly before an arbitrary date, not
 * just "before today". Same DISTINCT ON pattern/semantics.
 */
export async function getIsinPricesBeforeDate(beforeDate: string): Promise<Map<string, number>> {
  const rows = await db
    .selectDistinctOn([isinDailyPrice.isin], {
      isin: isinDailyPrice.isin,
      priceInr: isinDailyPrice.priceInr,
    })
    .from(isinDailyPrice)
    .where(lt(isinDailyPrice.snapshotDate, beforeDate))
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
  // true when netFlowCr/netFlowPct came from amcManualNetFlow (see
  // getEffectiveNetFlowForPeriod below) instead of the calculated formula.
  // Always false from getNetFlowForPeriod itself.
  netFlowIsManual: boolean;
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
    map.set(cur.amcId, {
      netFlowCr,
      netFlowPct,
      priorPeriod,
      priorPeriodReportedAumCr,
      baselineCr,
      monthEndDate,
      netFlowIsManual: false,
    });
  }

  return map;
}

/**
 * Non-null manual net flow overrides for one report period, keyed by amcId
 * -- see amcManualNetFlow in db/schema.ts. Only ever meaningfully populated
 * for the amc_listed_stock AMCs (the UI only offers the input for those 8),
 * but not restricted at the query level -- whatever's actually in the table
 * applies.
 */
export async function getManualNetFlowOverrides(reportPeriod: string): Promise<Map<number, number>> {
  const rows = await db
    .select({ amcId: amcManualNetFlow.amcId, netFlowOverrideCr: amcManualNetFlow.netFlowOverrideCr })
    .from(amcManualNetFlow)
    .where(eq(amcManualNetFlow.reportPeriod, reportPeriod));

  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.netFlowOverrideCr !== null) map.set(r.amcId, Number(r.netFlowOverrideCr));
  }
  return map;
}

/**
 * getNetFlowForPeriod, with any amcManualNetFlow overrides for this period
 * applied on top -- the single point every consumer of net flow should call
 * instead of getNetFlowForPeriod directly, so a manually-entered figure for
 * one of the 8 listed-stock AMCs reaches the Overview table, the AMC detail
 * page, and the flow-adjustment toggle's Live AUM/Average AUM figures all
 * at once. Deliberately NOT applied inside getAumGrowthComparison (the
 * Equity AUM Growth tab's own, separately-computed Net Flow/Price
 * Performance/Growth columns) -- see the manual-net-flow-override plan's
 * audit finding: those three figures hold an exact algebraic identity
 * (Price Performance + Net Flow = Growth) that an override here would
 * silently break, so that tab's own column for these 8 AMCs is deliberately
 * a separate, read-only-everywhere-else add-on instead.
 */
export async function getEffectiveNetFlowForPeriod(reportPeriod: string): Promise<Map<number, NetFlowEstimate>> {
  const [calculated, overrides] = await Promise.all([
    getNetFlowForPeriod(reportPeriod),
    getManualNetFlowOverrides(reportPeriod),
  ]);
  if (overrides.size === 0) return calculated;

  const map = new Map(calculated);
  for (const [amcId, netFlowOverrideCr] of overrides) {
    const base = map.get(amcId);
    if (!base) continue; // no calculated baseline to override (e.g. no prior period yet) -- skip rather than fabricate one
    map.set(amcId, {
      ...base,
      netFlowCr: netFlowOverrideCr,
      netFlowPct: base.priorPeriodReportedAumCr !== 0 ? netFlowOverrideCr / base.priorPeriodReportedAumCr : null,
      netFlowIsManual: true,
    });
  }
  return map;
}

export interface AumHistoryRangeRow {
  date: string;
  amcName: string; // "Industry Total" for the aggregate row
  liveAumCr: number;
  reportedAumCr: number;
}

/**
 * Every AMC's daily canonical Live/Reported AUM across an arbitrary
 * [fromDate, toDate] range, plus one synthetic "Industry Total" row per day
 * -- powers the Overview toolbar's date-range Excel export. Reuses the same
 * canonical liveAumDailySnapshot rows getIndustryAumHistory/
 * getAllAmcsLiveAumAsOf already read (no new schema), just bounded by a
 * date range instead of unbounded/single-date.
 */
export async function getAumHistoryRangeAllAmcs(fromDate: string, toDate: string): Promise<AumHistoryRangeRow[]> {
  const [perAmcRows, totalRows] = await Promise.all([
    db
      .select({
        date: liveAumDailySnapshot.snapshotDate,
        amcName: amcs.overviewName,
        liveAumCr: sql<number>`${liveAumDailySnapshot.liveAumCr}::float`,
        reportedAumCr: sql<number>`${liveAumDailySnapshot.reportedAumCr}::float`,
      })
      .from(liveAumDailySnapshot)
      .innerJoin(amcs, eq(liveAumDailySnapshot.amcId, amcs.id))
      .where(
        and(
          eq(liveAumDailySnapshot.isCanonical, true),
          gte(liveAumDailySnapshot.snapshotDate, fromDate),
          lte(liveAumDailySnapshot.snapshotDate, toDate)
        )
      )
      .orderBy(asc(liveAumDailySnapshot.snapshotDate), asc(amcs.overviewName)),
    db
      .select({
        date: liveAumDailySnapshot.snapshotDate,
        liveAumCr: sql<number>`sum(${liveAumDailySnapshot.liveAumCr})::float`,
        reportedAumCr: sql<number>`sum(${liveAumDailySnapshot.reportedAumCr})::float`,
      })
      .from(liveAumDailySnapshot)
      .where(
        and(
          eq(liveAumDailySnapshot.isCanonical, true),
          gte(liveAumDailySnapshot.snapshotDate, fromDate),
          lte(liveAumDailySnapshot.snapshotDate, toDate)
        )
      )
      .groupBy(liveAumDailySnapshot.snapshotDate)
      .orderBy(asc(liveAumDailySnapshot.snapshotDate)),
  ]);

  const rows: AumHistoryRangeRow[] = totalRows.map((r) => ({
    date: r.date,
    amcName: "Industry Total",
    liveAumCr: r.liveAumCr,
    reportedAumCr: r.reportedAumCr,
  }));
  for (const r of perAmcRows) rows.push(r);

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.amcName === "Industry Total") return -1;
    if (b.amcName === "Industry Total") return 1;
    return a.amcName.localeCompare(b.amcName);
  });
  return rows;
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

export interface AmcSwitcherEntry {
  slug: string;
  overviewName: string;
  liveAumCr: number | null;
}

/**
 * Every AMC's slug + name for the detail page's header switcher (dropdown +
 * Prev/Next), alongside its most recent canonical Live AUM for rank
 * ordering -- deliberately reads only liveAumDailySnapshot (at most a day
 * stale) rather than computeLiveAumForAmc's live-price pipeline, so opening
 * an AMC detail page never triggers a full 57-AMC recomputation just to
 * populate a nav control. An AMC with no canonical snapshot yet (e.g.
 * newly added, cron hasn't run) gets liveAumCr: null and sorts last.
 */
export async function getAmcSwitcherList(): Promise<AmcSwitcherEntry[]> {
  const [amcRows, { maxDate }] = await Promise.all([
    db.select({ slug: amcs.slug, overviewName: amcs.overviewName, id: amcs.id }).from(amcs),
    getCanonicalSnapshotDateBounds(),
  ]);

  const liveAumByAmcId = maxDate ? await getAllAmcsLiveAumAsOf(maxDate) : new Map<number, LiveAumAsOf>();

  return amcRows
    .map((r) => ({
      slug: r.slug,
      overviewName: r.overviewName,
      liveAumCr: liveAumByAmcId.get(r.id)?.liveAumCr ?? null,
    }))
    .sort((a, b) => a.overviewName.localeCompare(b.overviewName));
}
