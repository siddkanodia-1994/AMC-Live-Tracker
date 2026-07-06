import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, amcs, liveAumDailySnapshot } from "../db/schema";
import { lastDayOfReportMonth } from "./report-period";

// Which period's holdings get repriced to the chosen date. "A" (the default)
// reprices the earlier period's frozen holdings -- Price Performance/Net Flow
// then split Growth % cleanly, for any date, since Net Flow is defined as
// "whatever's left of Growth % once Price Performance is known." "B" reprices
// the later period's own holdings instead -- there's no third, still-later
// reported figure to reconcile against, so Net Flow has no coherent meaning
// there and is always null; Price Performance switches to being anchored on
// B's own reported AUM instead (matching the Overview tab's own "delta since
// report" framing), and is a different, unrelated-to-Growth% number.
export type RepriceBasis = "A" | "B";

export interface AumRepriceOverride {
  basis: RepriceBasis;
  // Resolved date to reprice to, or null when the basis period has zero
  // backfilled snapshots at all -- skips the repricing query entirely rather
  // than guessing, so computedAtDateCr comes back null for every AMC.
  asOfDate: string | null;
}

export interface AumGrowthRow {
  amcId: number;
  slug: string;
  overviewName: string;
  periodAReportedAumCr: number;
  periodBReportedAumCr: number;
  // B - A. Never null -- needs only each period's own reportedAumCr. Never
  // affected by repriceBasis/asOfDate -- it has nothing to do with repricing.
  growthCr: number;
  // (B - A) / A
  growthPct: number | null;
  // basis A: computedAtDate - A. basis B: computedAtDate - B (anchored on the
  // basis period's own reported AUM either way). Null when that basis period
  // hasn't been backfilled through the chosen date yet.
  pricePerformanceCr: number | null;
  // basis A: (computedAtDate - A) / A. basis B: (computedAtDate - B) / B --
  // the denominator switches with the basis, since under B there's no longer
  // a shared "A" baseline this figure is meant to relate back to.
  pricePerformancePct: number | null;
  // B - computedAtDate, only when basis = A (see RepriceBasis doc comment
  // for why basis = B has no coherent Net Flow). growthCr = pricePerformanceCr
  // + netFlowCr exactly whenever both are non-null, for any chosen date under
  // basis A -- not just at periodB's month-end.
  netFlowCr: number | null;
  // (B - computedAtDate) / A, only when basis = A -- same denominator as
  // pricePerformancePct (basis A), so the two always sum to exactly growthPct.
  netFlowPct: number | null;
  // The basis period's holdings repriced as of the resolved date -- basis A
  // by default, matching the pre-existing "computedBAumCr" concept exactly
  // when asOfDate resolves to periodB's month-end (the default).
  computedAtDateCr: number | null;
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
 * Every calendar date that has at least one backfilled liveAumDailySnapshot
 * row for the given period's holdings, oldest first -- for populating the
 * "reprice as of" date picker so it can only ever offer dates that actually
 * have data (never an empty result). Doesn't require every AMC to have a row
 * on a given date, same tolerance getAvailableReportPeriods already has for
 * periods -- an individual AMC still degrades to null/"—" for a date it's
 * missing, same as computedAtDateCr already does.
 */
export async function getAvailableSnapshotDates(reportPeriod: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ snapshotDate: liveAumDailySnapshot.snapshotDate })
    .from(liveAumDailySnapshot)
    .where(eq(liveAumDailySnapshot.reportPeriod, reportPeriod))
    .orderBy(asc(liveAumDailySnapshot.snapshotDate));
  return rows.map((r) => r.snapshotDate);
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
export async function getAumGrowthComparison(
  periodA: string,
  periodB: string,
  override?: AumRepriceOverride
): Promise<AumGrowthRow[]> {
  // No override -> exactly today's pre-existing behavior: reprice A's
  // holdings through B's month-end. An override with asOfDate = null means
  // "this basis period has zero backfilled snapshots at all" -- skip the
  // repricing query entirely rather than falling back to a default, so
  // computedAtDateCr comes back null for every AMC instead of a wrong value.
  const basis: RepriceBasis = override?.basis ?? "A";
  const basisPeriod = basis === "B" ? periodB : periodA;
  const boundDate: string | null = override ? override.asOfDate : lastDayOfReportMonth(periodB);

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
    boundDate !== null
      ? db
          .select({
            amcId: liveAumDailySnapshot.amcId,
            snapshotDate: liveAumDailySnapshot.snapshotDate,
            liveAumCr: liveAumDailySnapshot.liveAumCr,
          })
          .from(liveAumDailySnapshot)
          .where(and(eq(liveAumDailySnapshot.reportPeriod, basisPeriod), lte(liveAumDailySnapshot.snapshotDate, boundDate)))
          .orderBy(desc(liveAumDailySnapshot.snapshotDate))
      : Promise.resolve([]),
  ]);

  const computedAtDateByAmcId = new Map<number, number>();
  for (const r of baselineSnapshots) {
    if (!computedAtDateByAmcId.has(r.amcId)) {
      computedAtDateByAmcId.set(r.amcId, Number(r.liveAumCr));
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

    const computedAtDateCr = computedAtDateByAmcId.get(amcId) ?? null;
    const anchorCr = basis === "B" ? periodBReportedAumCr : periodAReportedAumCr;
    const pricePerformanceCr = computedAtDateCr !== null ? computedAtDateCr - anchorCr : null;
    const pricePerformancePct = pricePerformanceCr !== null && anchorCr !== 0 ? pricePerformanceCr / anchorCr : null;

    // Net Flow has no coherent meaning when repricing B's own holdings -- see
    // the RepriceBasis doc comment. Always null under basis B, regardless of
    // whether computedAtDateCr resolved.
    const netFlowCr = basis === "A" && computedAtDateCr !== null ? periodBReportedAumCr - computedAtDateCr : null;
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
      computedAtDateCr,
    });
  }

  return rows;
}
