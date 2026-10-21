import { and, asc, desc, gte, inArray, lte } from "drizzle-orm";
import { db } from "../db/client";
import { etfSchemes, etfExitAumAnchor, etfDailyAumEstimate, etfDailyNav } from "../db/schema";
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

  // Only schemes with an actual gap between their last real (backfilled)
  // data point and rangeEnd need any NAV at all -- a window entirely
  // covered by etf_daily_aum_estimate (e.g. any fully-closed historical
  // quarter) needs no live tail, so no NAV fetch of any kind for those
  // schemes. This used to fetch NAV unconditionally on every call,
  // including for 100%-historical queries whose result was immediately
  // discarded -- a real, confirmed source of redundant TigZig calls
  // (Overview's Live AUM alone polls every 45s with the blend toggle on).
  let navFetchStart = startDate;
  const schemesNeedingTail: typeof schemes = [];
  for (const s of schemes) {
    const real = realBySchemeId.get(s.id) ?? [];
    const lastAnchor = lastAnchorBySchemeId.get(s.id);
    const lastRealDate = real.length > 0 ? real[real.length - 1].date : (lastAnchor?.anchorDate ?? null);
    if (!lastAnchor || lastRealDate === null || lastRealDate >= rangeEnd) continue;
    schemesNeedingTail.push(s);
    // The live tail below needs the NAV *on the last real anchor date* to
    // compute each day's roll-forward ratio (anchorNav) -- so the NAV
    // fetch must reach back to this scheme's own last anchor, not just the
    // caller's own startDate (confirmed bug otherwise: produced a false
    // -23% QoQ reading for Nippon's Gold/Silver blend once Q2FY27's
    // anchors became the past quarter).
    if (lastAnchor.anchorDate < navFetchStart) navFetchStart = lastAnchor.anchorDate;
  }

  const navBySchemeId = new Map<number, NavPoint[]>();
  if (schemesNeedingTail.length > 0) {
    // Read from the local daily cache first (etf_daily_nav -- populated
    // once a day by runEtfIngestion/src/lib/etf/ingest.ts for the older
    // ratio-based live-AUM feature, but equally valid raw daily NAV for
    // this purpose too) instead of hitting TigZig live on every call. Only
    // schemes whose cached coverage doesn't fully span [navFetchStart,
    // rangeEnd] -- e.g. an anchor older than the cache's own history
    // (which only started 2026-09-07), or "today" before that day's cron
    // has run yet -- fall back to a live fetch, for just their own range.
    const cachedRows = await db
      .select({ schemeId: etfDailyNav.schemeId, snapshotDate: etfDailyNav.snapshotDate, nav: etfDailyNav.nav })
      .from(etfDailyNav)
      .where(
        and(
          inArray(etfDailyNav.schemeId, schemesNeedingTail.map((s) => s.id)),
          gte(etfDailyNav.snapshotDate, navFetchStart),
          lte(etfDailyNav.snapshotDate, rangeEnd)
        )
      )
      .orderBy(asc(etfDailyNav.snapshotDate));
    const navSourceBySchemeId = new Map<number, NavPoint[]>();
    for (const r of cachedRows) {
      if (!navSourceBySchemeId.has(r.schemeId)) navSourceBySchemeId.set(r.schemeId, []);
      navSourceBySchemeId.get(r.schemeId)!.push({ date: r.snapshotDate, nav: Number(r.nav) });
    }

    const schemesNeedingLiveFetch = schemesNeedingTail.filter((s) => {
      const cached = navSourceBySchemeId.get(s.id);
      return !cached || cached.length === 0 || cached[0].date > navFetchStart || cached[cached.length - 1].date < rangeEnd;
    });

    if (schemesNeedingLiveFetch.length > 0) {
      const liveNavMap = await fetchFullNavHistory(
        schemesNeedingLiveFetch.map((s) => s.schemeCode),
        navFetchStart,
        rangeEnd
      );
      for (const s of schemesNeedingLiveFetch) {
        navSourceBySchemeId.set(s.id, liveNavMap.get(s.schemeCode) ?? []);
      }
    }

    for (const s of schemesNeedingTail) {
      const raw = navSourceBySchemeId.get(s.id) ?? [];
      navBySchemeId.set(s.id, raw.length > 0 ? adjustNavForSplits(raw).adjusted : []);
    }
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
