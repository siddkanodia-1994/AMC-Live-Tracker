import { and, asc, desc, gte, inArray, lte } from "drizzle-orm";
import { db } from "../db/client";
import { etfSchemes, etfExitAumAnchor, etfDailyAumEstimate } from "../db/schema";
import { fetchFullNavHistory } from "./tigzig-client";
import { adjustNavForSplits } from "./nav-split-detection";
import type { NavPoint } from "./historical-backfill";
import { getIstDateString } from "../utils/date";

export interface EtfDailyPoint {
  date: string;
  aum: number;
}

/**
 * Every Gold/Silver scheme's daily AUM series over [startDate, endDate],
 * combining the real, fully-reconciled `etf_daily_aum_estimate` rows with a
 * live, NOT persisted NAV-only roll-forward for any day past a scheme's
 * last real anchor (an open, not-yet-closed segment) -- no flow assumed
 * for that tail, same principle used throughout this feature (see
 * window-comparison.ts, which this function was extracted from, for the
 * original rationale). Pulled out as its own module so every consumer of
 * "a scheme's daily AUM, extrapolated live where needed" -- the Gold/
 * Silver tab's own window comparison AND the equity-AUM blending feature
 * -- shares identical methodology instead of two copies drifting apart.
 */
export async function getEtfCombinedDailySeriesBySchemeIds(
  schemeIds: number[],
  startDate: string,
  endDate: string
): Promise<Map<number, EtfDailyPoint[]>> {
  const map = new Map<number, EtfDailyPoint[]>();
  if (schemeIds.length === 0) return map;

  const today = getIstDateString();
  const rangeEnd = endDate > today ? today : endDate;

  const schemes = await db
    .select({ id: etfSchemes.id, schemeCode: etfSchemes.schemeCode })
    .from(etfSchemes)
    .where(inArray(etfSchemes.id, schemeIds));

  const lastAnchorRows = await db
    .select({ schemeId: etfExitAumAnchor.schemeId, anchorDate: etfExitAumAnchor.anchorDate, exitAumCr: etfExitAumAnchor.exitAumCr })
    .from(etfExitAumAnchor)
    .where(inArray(etfExitAumAnchor.schemeId, schemeIds))
    .orderBy(desc(etfExitAumAnchor.anchorDate));
  const lastAnchorBySchemeId = new Map<number, { anchorDate: string; exitAumCr: number }>();
  for (const r of lastAnchorRows) {
    if (!lastAnchorBySchemeId.has(r.schemeId)) lastAnchorBySchemeId.set(r.schemeId, { anchorDate: r.anchorDate, exitAumCr: Number(r.exitAumCr) });
  }

  const realDailyRows = await db
    .select({ schemeId: etfDailyAumEstimate.schemeId, snapshotDate: etfDailyAumEstimate.snapshotDate, estimatedAumCr: etfDailyAumEstimate.estimatedAumCr })
    .from(etfDailyAumEstimate)
    .where(and(inArray(etfDailyAumEstimate.schemeId, schemeIds), gte(etfDailyAumEstimate.snapshotDate, startDate), lte(etfDailyAumEstimate.snapshotDate, rangeEnd)))
    .orderBy(asc(etfDailyAumEstimate.snapshotDate));
  const realBySchemeId = new Map<number, EtfDailyPoint[]>();
  for (const r of realDailyRows) {
    if (!realBySchemeId.has(r.schemeId)) realBySchemeId.set(r.schemeId, []);
    realBySchemeId.get(r.schemeId)!.push({ date: r.snapshotDate, aum: Number(r.estimatedAumCr) });
  }

  const navMap = await fetchFullNavHistory(
    schemes.map((s) => s.schemeCode),
    startDate,
    rangeEnd
  );
  const navBySchemeId = new Map<number, NavPoint[]>();
  for (const s of schemes) {
    const raw = navMap.get(s.schemeCode) ?? [];
    navBySchemeId.set(s.id, raw.length > 0 ? adjustNavForSplits(raw).adjusted : []);
  }

  function navOnOrBefore(adjustedNav: NavPoint[], date: string): number | null {
    let result: number | null = null;
    for (const p of adjustedNav) {
      if (p.date > date) break;
      result = p.nav;
    }
    return result;
  }

  for (const s of schemes) {
    const real = (realBySchemeId.get(s.id) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const lastAnchor = lastAnchorBySchemeId.get(s.id);
    const adjustedNav = navBySchemeId.get(s.id) ?? [];

    if (!lastAnchor || adjustedNav.length === 0) {
      map.set(s.id, real);
      continue;
    }

    const lastRealDate = real.length > 0 ? real[real.length - 1].date : lastAnchor.anchorDate;
    const anchorNav = navOnOrBefore(adjustedNav, lastAnchor.anchorDate);
    if (anchorNav == null) {
      map.set(s.id, real);
      continue;
    }

    const liveTail = adjustedNav
      .filter((p) => p.date > lastRealDate && p.date <= rangeEnd)
      .map((p) => ({ date: p.date, aum: lastAnchor.exitAumCr * (p.nav / anchorNav) }));
    map.set(s.id, [...real, ...liveTail]);
  }

  return map;
}
