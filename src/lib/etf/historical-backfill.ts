import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { etfExitAumAnchor, etfDailyAumEstimate } from "../db/schema";
import { adjustNavForSplits, type DetectedNavSplit } from "./nav-split-detection";

const BATCH_SIZE = 500;

export interface EtfHistoricalBackfillResult {
  schemeId: number;
  anchorsUsed: number;
  segmentsComputed: number;
  rowsWritten: number;
  firstWrittenDate: string | null;
  lastWrittenDate: string | null;
  detectedSplits: DetectedNavSplit[];
  warnings: string[];
}

export interface NavPoint {
  date: string;
  nav: number;
}

/**
 * Computes and upserts etf_daily_aum_estimate for one scheme, bridging its
 * etf_exit_aum_anchor real points with that scheme's OWN daily NAV return
 * (not a generic commodity index -- see the plan's rationale: a scheme's
 * own NAV already captures expense-ratio drag and whatever valuation
 * convention applied on each date, including the April-2026 SEBI change to
 * domestic-spot-price valuation). Takes the scheme's NAV history as a
 * plain array -- already fetched by the caller via fetchFullNavHistory,
 * keyed by TigZig scheme code -- rather than looking it up itself, so the
 * orchestration script can fetch all 45 schemes' NAV histories in a
 * handful of batched API calls up front instead of one call per scheme.
 *
 * Reconciliation: a Modified-Dietz-style EQUAL Rs flow per day, not the
 * multiplicative ramp amcHistoricalAumEstimate uses (src/lib/aum/
 * historical-backfill.ts) -- appropriate here because a single-commodity
 * ETF's own tracking error vs. its own NAV is near-zero, so nearly the
 * whole gap between the roll-forward and the next real anchor genuinely is
 * investor flow. For a segment with real anchors (startAum, endAum) and n
 * daily NAV returns r(1)..r(n):
 *   1. raw(0)=startAum; raw(j)=raw(j-1)*r(j)            -- pure price roll-forward, audit only
 *   2. f(n)=1; f(k)=f(k+1)*r(k+1)                        -- forward-compounding factor for a flow invested at end of day k
 *   3. dailyFlow = (endAum - raw(n)) / sum(f(1..n))      -- the one constant flow that reconciles the segment
 *   4. est(0)=startAum; est(j)=est(j-1)*r(j)+dailyFlow   -- by construction est(n) == endAum exactly
 * Flow convention: invested at day-end (doesn't earn that day's own return,
 * does earn every subsequent day's return in the segment).
 */
export async function computeEtfHistoricalAumEstimatesForScheme(schemeId: number, navHistory: NavPoint[]): Promise<EtfHistoricalBackfillResult> {
  const warnings: string[] = [];
  const anchors = await db
    .select()
    .from(etfExitAumAnchor)
    .where(eq(etfExitAumAnchor.schemeId, schemeId))
    .orderBy(asc(etfExitAumAnchor.anchorDate));

  if (anchors.length < 2) {
    warnings.push(`Only ${anchors.length} anchor(s) found -- need at least 2 to compound between.`);
    return { schemeId, anchorsUsed: anchors.length, segmentsComputed: 0, rowsWritten: 0, firstWrittenDate: null, lastWrittenDate: null, detectedSplits: [], warnings };
  }

  // A real NAV unit-split/rebasing event (e.g. a clean 10x jump with no
  // real change in investor value) would otherwise read as a fake price
  // crash and corrupt the whole segment's flow reconciliation below -- see
  // nav-split-detection.ts. navHistory is sorted ascending by fetchFullNavHistory.
  const { adjusted: adjustedNavHistory, detectedSplits } = adjustNavForSplits(navHistory);
  const navByDate = new Map(adjustedNavHistory.map((n) => [n.date, n.nav]));
  const sortedNavDates = adjustedNavHistory.map((n) => n.date).sort();

  const rowsToWrite: (typeof etfDailyAumEstimate.$inferInsert)[] = [];
  let segmentsComputed = 0;

  for (let i = 0; i < anchors.length - 1; i++) {
    const start = anchors[i];
    const end = anchors[i + 1];
    const startDate = start.anchorDate;
    const endDate = end.anchorDate;
    const startAum = Number(start.exitAumCr);
    const endAum = Number(end.exitAumCr);

    // Trading days strictly between the two anchors, plus the end date itself.
    const tradingDays = sortedNavDates.filter((d) => d > startDate && d <= endDate);
    if (tradingDays.length === 0 || !navByDate.has(startDate)) {
      warnings.push(`Segment ${startDate}->${endDate}: missing NAV data -- skipped.`);
      continue;
    }

    const n = tradingDays.length;
    // r(j) = nav(day j) / nav(day j-1), where day 0 is startDate.
    const returns: number[] = [];
    let prevNav = navByDate.get(startDate)!;
    let missingNav = false;
    for (const d of tradingDays) {
      const nav = navByDate.get(d);
      if (nav == null) {
        missingNav = true;
        break;
      }
      returns.push(nav / prevNav);
      prevNav = nav;
    }
    if (missingNav) {
      warnings.push(`Segment ${startDate}->${endDate}: a trading day in range has no NAV -- skipped.`);
      continue;
    }

    // Step 1: pure price roll-forward (no flow), for audit.
    const raw: number[] = [startAum];
    for (let j = 0; j < n; j++) raw.push(raw[j] * returns[j]);
    const rawFinal = raw[n];

    // Step 2: forward-compounding factor for a flow invested at end of day k (1-indexed).
    const f: number[] = new Array(n + 1).fill(1);
    f[n] = 1;
    for (let k = n - 1; k >= 1; k--) f[k] = f[k + 1] * returns[k]; // returns is 0-indexed, returns[k] = r(k+1)

    const sumF = f.slice(1, n + 1).reduce((a, b) => a + b, 0);

    // Step 3: solve the one constant daily flow for this segment.
    let dailyFlowCr: number;
    if (sumF === 0) {
      // 1-day segment edge case: fall back to a lump-sum adjustment on that single day.
      dailyFlowCr = endAum - rawFinal;
    } else {
      dailyFlowCr = (endAum - rawFinal) / sumF;
    }

    // Step 4: final forward pass, return + flow.
    const estimated: number[] = [startAum];
    for (let j = 0; j < n; j++) estimated.push(estimated[j] * returns[j] + dailyFlowCr);

    for (let j = 0; j < n; j++) {
      rowsToWrite.push({
        schemeId,
        snapshotDate: tradingDays[j],
        estimatedAumCr: String(estimated[j + 1]),
        rawCompoundedAumCr: String(raw[j + 1]),
        dailyFlowCr: String(dailyFlowCr),
        anchorStartDate: startDate,
        anchorEndDate: endDate,
      });
    }
    segmentsComputed++;
  }

  for (let i = 0; i < rowsToWrite.length; i += BATCH_SIZE) {
    const batch = rowsToWrite.slice(i, i + BATCH_SIZE);
    await db
      .insert(etfDailyAumEstimate)
      .values(batch)
      .onConflictDoUpdate({
        target: [etfDailyAumEstimate.schemeId, etfDailyAumEstimate.snapshotDate],
        set: {
          estimatedAumCr: sql`excluded.estimated_aum_cr`,
          rawCompoundedAumCr: sql`excluded.raw_compounded_aum_cr`,
          dailyFlowCr: sql`excluded.daily_flow_cr`,
          anchorStartDate: sql`excluded.anchor_start_date`,
          anchorEndDate: sql`excluded.anchor_end_date`,
          computedAt: sql`now()`,
        },
      });
  }

  return {
    schemeId,
    anchorsUsed: anchors.length,
    segmentsComputed,
    rowsWritten: rowsToWrite.length,
    firstWrittenDate: rowsToWrite[0]?.snapshotDate ?? null,
    lastWrittenDate: rowsToWrite[rowsToWrite.length - 1]?.snapshotDate ?? null,
    detectedSplits,
    warnings,
  };
}
