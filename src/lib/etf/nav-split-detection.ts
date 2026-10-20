import type { NavPoint } from "./historical-backfill";

// Candidate corporate-action/unit-rebasing ratios, mirroring
// src/lib/aum/split-detection.ts's own equity-side list exactly -- forward
// splits/unit rebasing (NAV falls, units outstanding rises) tested
// directly; reverse splits/consolidations (NAV rises, units fall) tested
// against the reciprocal. Confirmed live on real Gold/Silver ETF data
// (2026-10-20): 8 of 45 schemes have a genuine NAV rebasing event
// somewhere in their history (clean 10x or 100x jumps), e.g. DSP Gold ETF
// dropping from Rs 152.38 to Rs 15.34 overnight on 2026-08-28 and staying
// there -- not a price crash, not a data glitch.
const CANDIDATE_RATIOS = [2, 3, 4, 5, 10, 20, 25, 50, 100];
const TOLERANCE_PCT = 0.08;
const NORMAL_DAY_RATIO_MIN = 0.7;
const NORMAL_DAY_RATIO_MAX = 1.4;
const PERSISTENCE_LOOKAHEAD_DAYS = 3;

export interface DetectedNavSplit {
  date: string;
  rawRatio: number;
  matchedRatio: number; // >1: NAV fell by this factor; <1: NAV rose by this factor (1/matchedRatio)
}

interface RatioMatch {
  matchedRatio: number;
  deviationPct: number;
}

// Same matching logic as split-detection.ts's findClosestRatioMatch,
// expressed in NAV terms instead of shares: rawRatio = navBefore/navAfter.
function findClosestRatioMatch(rawRatio: number): RatioMatch | null {
  const testRatio = rawRatio >= 1 ? rawRatio : 1 / rawRatio;
  let best: RatioMatch | null = null;
  for (const candidate of CANDIDATE_RATIOS) {
    const deviationPct = Math.abs(testRatio - candidate) / candidate;
    if (deviationPct <= TOLERANCE_PCT && (best === null || deviationPct < best.deviationPct)) {
      best = { matchedRatio: candidate, deviationPct };
    }
  }
  if (best === null) return null;
  const matchedRatio = rawRatio >= 1 ? best.matchedRatio : 1 / best.matchedRatio;
  return { matchedRatio, deviationPct: best.deviationPct };
}

// A real split's new NAV level holds; a one-day data glitch bounces back
// the next day. Requires the next few available points to stay within a
// normal day-to-day range of each other -- if there's no more data to
// check against, the clean-ratio match itself is accepted as sufficient
// evidence.
function isPersistent(navHistory: NavPoint[], splitIndex: number): boolean {
  const end = Math.min(navHistory.length, splitIndex + 1 + PERSISTENCE_LOOKAHEAD_DAYS);
  let prev = navHistory[splitIndex].nav;
  for (let k = splitIndex + 1; k < end; k++) {
    const ratio = navHistory[k].nav / prev;
    if (ratio > NORMAL_DAY_RATIO_MAX || ratio < NORMAL_DAY_RATIO_MIN) return false;
    prev = navHistory[k].nav;
  }
  return true;
}

export interface AdjustNavForSplitsResult {
  adjusted: NavPoint[];
  detectedSplits: DetectedNavSplit[];
}

/**
 * Rescales a scheme's NAV history so a real unit-split/rebasing event
 * (NAV jumps by a clean ratio like 10x or 100x, with no real change in
 * investor value) reads as a continuous series instead of a fake price
 * crash/spike. Every NAV point from a confirmed split date onward is
 * multiplied by the matched ratio, so day-over-day returns computed from
 * `adjusted` are correct across the boundary. The original `navHistory`
 * (fetched fresh from TigZig every run, never stored by this app) is left
 * untouched -- this only affects the in-memory series used for this one
 * computation, same "never rescale the raw source" principle the equity
 * side's isinShareAdjustment uses, just expressed at read-time here
 * instead of via a stored share-count multiplier.
 */
export function adjustNavForSplits(navHistory: NavPoint[]): AdjustNavForSplitsResult {
  const detectedSplits: DetectedNavSplit[] = [];
  if (navHistory.length === 0) return { adjusted: [], detectedSplits };

  const adjusted: NavPoint[] = [{ ...navHistory[0] }];
  let cumulativeMultiplier = 1;

  for (let i = 1; i < navHistory.length; i++) {
    const rawPrev = navHistory[i - 1].nav;
    const rawCurr = navHistory[i].nav;
    const rawRatio = rawPrev / rawCurr;

    if (rawRatio > NORMAL_DAY_RATIO_MAX || rawRatio < NORMAL_DAY_RATIO_MIN) {
      const match = findClosestRatioMatch(rawRatio);
      if (match && isPersistent(navHistory, i)) {
        detectedSplits.push({ date: navHistory[i].date, rawRatio, matchedRatio: match.matchedRatio });
        cumulativeMultiplier *= match.matchedRatio;
      }
    }

    adjusted.push({ date: navHistory[i].date, nav: rawCurr * cumulativeMultiplier });
  }

  return { adjusted, detectedSplits };
}
