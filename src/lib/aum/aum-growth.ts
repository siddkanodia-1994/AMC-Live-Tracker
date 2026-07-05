import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, amcs, liveAumDailySnapshot } from "../db/schema";
import { lastDayOfReportMonth } from "./report-period";

export interface AumGrowthRow {
  amcId: number;
  slug: string;
  overviewName: string;
  periodAReportedAumCr: number;
  periodBReportedAumCr: number;
  // B - A. Never null -- needs only each period's own reportedAumCr.
  growthCr: number;
  // (B - A) / A
  growthPct: number | null;
  // computedB - A -- computedB is periodA's holdings repriced to periodB's
  // last trading day (see backfillDailySnapshots). Null when that backfill
  // hasn't been run for this specific period pair yet.
  pricePerformanceCr: number | null;
  // (computedB - A) / A
  pricePerformancePct: number | null;
  // B - computedB. growthCr = pricePerformanceCr + netFlowCr exactly,
  // whenever both are non-null (same identity the % versions satisfy).
  netFlowCr: number | null;
  // (B - computedB) / A -- same denominator as pricePerformancePct, so the
  // two always sum to exactly growthPct.
  netFlowPct: number | null;
  computedBAumCr: number | null;
}

/**
 * Every report period that's been imported, oldest first -- for populating a
 * period-picker. Unlike getNetFlowForPeriod/getPeriodComparison (which only
 * ever fetch the 1 or 2 most recent periods), this is intentionally unscoped.
 */
export async function getAvailableReportPeriods(): Promise<string[]> {
  const rows = await db.selectDistinct({ reportPeriod: amcPeriods.reportPeriod }).from(amcPeriods).orderBy(asc(amcPeriods.reportPeriod));
  return rows.map((r) => r.reportPeriod);
}

/**
 * Decomposes AUM growth between any two report periods into a price-driven
 * component and a flow-driven component, both expressed as a % of periodA's
 * reported AUM so they sum exactly to the overall growth %. See
 * getNetFlowForPeriod (history.ts) for the closely related "current vs. its
 * auto-detected predecessor, divided by the computed baseline" version this
 * is deliberately kept separate from -- that function's return shape is
 * wired into compute-live-aum.ts/AmcLiveAum already, and reusing it here
 * would mean risking the already-shipped, already-hand-verified Net Flow
 * feature for a signature change it doesn't need.
 *
 * Only AMCs present in both periods are returned. pricePerformancePct /
 * netFlowPct / computedBAumCr are null when periodA's holdings haven't been
 * backfilled through periodB's month-end yet (see backfillDailySnapshots) --
 * growthPct still works regardless, since it only needs each period's own
 * reportedAumCr.
 */
export async function getAumGrowthComparison(periodA: string, periodB: string): Promise<AumGrowthRow[]> {
  const monthEndDate = lastDayOfReportMonth(periodB);

  const [periodRows, baselineSnapshots] = await Promise.all([
    db
      .select({
        amcId: amcPeriods.amcId,
        slug: amcs.slug,
        overviewName: amcs.overviewName,
        reportPeriod: amcPeriods.reportPeriod,
        reportedAumCr: amcPeriods.reportedAumCr,
      })
      .from(amcPeriods)
      .innerJoin(amcs, eq(amcPeriods.amcId, amcs.id))
      .where(inArray(amcPeriods.reportPeriod, [periodA, periodB])),
    db
      .select({
        amcId: liveAumDailySnapshot.amcId,
        snapshotDate: liveAumDailySnapshot.snapshotDate,
        liveAumCr: liveAumDailySnapshot.liveAumCr,
      })
      .from(liveAumDailySnapshot)
      .where(and(eq(liveAumDailySnapshot.reportPeriod, periodA), lte(liveAumDailySnapshot.snapshotDate, monthEndDate)))
      .orderBy(desc(liveAumDailySnapshot.snapshotDate)),
  ]);

  const computedBByAmcId = new Map<number, number>();
  for (const r of baselineSnapshots) {
    if (!computedBByAmcId.has(r.amcId)) {
      computedBByAmcId.set(r.amcId, Number(r.liveAumCr));
    }
  }

  const byAmcId = new Map<number, { slug: string; overviewName: string; a?: number; b?: number }>();
  for (const r of periodRows) {
    const entry = byAmcId.get(r.amcId) ?? { slug: r.slug, overviewName: r.overviewName };
    if (r.reportPeriod === periodA) entry.a = Number(r.reportedAumCr);
    else entry.b = Number(r.reportedAumCr);
    byAmcId.set(r.amcId, entry);
  }

  const rows: AumGrowthRow[] = [];
  for (const [amcId, entry] of byAmcId) {
    if (entry.a === undefined || entry.b === undefined) continue;
    const periodAReportedAumCr = entry.a;
    const periodBReportedAumCr = entry.b;
    const growthCr = periodBReportedAumCr - periodAReportedAumCr;
    const growthPct = periodAReportedAumCr !== 0 ? growthCr / periodAReportedAumCr : null;

    const computedBAumCr = computedBByAmcId.get(amcId) ?? null;
    const pricePerformanceCr = computedBAumCr !== null ? computedBAumCr - periodAReportedAumCr : null;
    const pricePerformancePct =
      pricePerformanceCr !== null && periodAReportedAumCr !== 0 ? pricePerformanceCr / periodAReportedAumCr : null;
    const netFlowCr = computedBAumCr !== null ? periodBReportedAumCr - computedBAumCr : null;
    const netFlowPct = netFlowCr !== null && periodAReportedAumCr !== 0 ? netFlowCr / periodAReportedAumCr : null;

    rows.push({
      amcId,
      slug: entry.slug,
      overviewName: entry.overviewName,
      periodAReportedAumCr,
      periodBReportedAumCr,
      growthCr,
      growthPct,
      pricePerformanceCr,
      pricePerformancePct,
      netFlowCr,
      netFlowPct,
      computedBAumCr,
    });
  }

  return rows;
}
