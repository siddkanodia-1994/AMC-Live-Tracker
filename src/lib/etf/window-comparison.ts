import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { etfSchemes, etfExitAumAnchor, etfDailyAumEstimate } from "../db/schema";
import { fetchFullNavHistory } from "./tigzig-client";
import { adjustNavForSplits } from "./nav-split-detection";
import type { NavPoint } from "./historical-backfill";
import { getIstDateString } from "../utils/date";

export interface DateWindow {
  start: string;
  end: string;
}

export interface EtfWindowFigures {
  avgAumCr: number | null;
  exitAumCr: number | null;
}

export interface EtfWindowComparisonRow {
  schemeId: number;
  window1: EtfWindowFigures;
  window2: EtfWindowFigures;
  priceOnlyPct: number | null; // split-adjusted NAV(window2.end) / NAV(window1.end) - 1
}

export interface EtfDataBounds {
  minDate: string | null;
  maxDate: string | null;
}

/** The real backfilled history's actual span -- feeds listFiscalQuarters() so the
 * Gold/Silver quarter pickers only ever offer quarters with real data behind them. */
export async function getEtfDataBounds(): Promise<EtfDataBounds> {
  const [row] = await db
    .select({
      minDate: sql<string | null>`min(${etfExitAumAnchor.anchorDate})`,
      maxDate: sql<string | null>`max(${etfExitAumAnchor.anchorDate})`,
    })
    .from(etfExitAumAnchor);
  return { minDate: row?.minDate ?? null, maxDate: row?.maxDate ?? null };
}

/**
 * Figures for both comparison windows, per scheme, plus the point-to-point
 * split-adjusted NAV return between the windows' end dates (the "Price QoQ"
 * component the UI subtracts from the total to get "Flow QoQ").
 *
 * A window whose end date reaches past a scheme's last real anchor (i.e. an
 * open, not-yet-closed quarter) is filled in with a live, NOT persisted
 * NAV-only roll-forward from that last anchor -- no flow assumed, same
 * "never fabricate a flow number for a period that hasn't closed" principle
 * confirmed for this feature. That live tail is computed fresh on every call
 * from the same NAV fetch already needed for the price-only component, never
 * written to etf_daily_aum_estimate (which stays "fully reconciled real
 * segments only").
 */
export async function getEtfWindowComparison(window1: DateWindow, window2: DateWindow): Promise<EtfWindowComparisonRow[]> {
  const today = getIstDateString();
  const rangeStart = window1.start < window2.start ? window1.start : window2.start;
  const rangeEndRequested = window1.end > window2.end ? window1.end : window2.end;
  const rangeEnd = rangeEndRequested > today ? today : rangeEndRequested;

  const schemes = await db.select({ id: etfSchemes.id, schemeCode: etfSchemes.schemeCode }).from(etfSchemes);

  const lastAnchorRows = await db
    .select({ schemeId: etfExitAumAnchor.schemeId, anchorDate: etfExitAumAnchor.anchorDate, exitAumCr: etfExitAumAnchor.exitAumCr })
    .from(etfExitAumAnchor)
    .orderBy(desc(etfExitAumAnchor.anchorDate));
  const lastAnchorBySchemeId = new Map<number, { anchorDate: string; exitAumCr: number }>();
  for (const r of lastAnchorRows) {
    if (!lastAnchorBySchemeId.has(r.schemeId)) lastAnchorBySchemeId.set(r.schemeId, { anchorDate: r.anchorDate, exitAumCr: Number(r.exitAumCr) });
  }

  const realDailyRows = await db
    .select({ schemeId: etfDailyAumEstimate.schemeId, snapshotDate: etfDailyAumEstimate.snapshotDate, estimatedAumCr: etfDailyAumEstimate.estimatedAumCr })
    .from(etfDailyAumEstimate)
    .where(and(gte(etfDailyAumEstimate.snapshotDate, rangeStart), lte(etfDailyAumEstimate.snapshotDate, rangeEnd)))
    .orderBy(asc(etfDailyAumEstimate.snapshotDate));
  const realBySchemeId = new Map<number, { date: string; aum: number }[]>();
  for (const r of realDailyRows) {
    if (!realBySchemeId.has(r.schemeId)) realBySchemeId.set(r.schemeId, []);
    realBySchemeId.get(r.schemeId)!.push({ date: r.snapshotDate, aum: Number(r.estimatedAumCr) });
  }

  const navMap = await fetchFullNavHistory(
    schemes.map((s) => s.schemeCode),
    rangeStart,
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

  function combinedSeries(schemeId: number): { date: string; aum: number }[] {
    const real = realBySchemeId.get(schemeId) ?? [];
    const lastAnchor = lastAnchorBySchemeId.get(schemeId);
    const adjustedNav = navBySchemeId.get(schemeId) ?? [];
    if (!lastAnchor || adjustedNav.length === 0) return real;

    const lastRealDate = real.length > 0 ? real[real.length - 1].date : lastAnchor.anchorDate;
    const anchorNav = navOnOrBefore(adjustedNav, lastAnchor.anchorDate);
    if (anchorNav == null) return real;

    const liveTail = adjustedNav
      .filter((p) => p.date > lastRealDate)
      .map((p) => ({ date: p.date, aum: lastAnchor.exitAumCr * (p.nav / anchorNav) }));
    return [...real, ...liveTail];
  }

  function figuresForWindow(series: { date: string; aum: number }[], w: DateWindow): EtfWindowFigures {
    // Sorted defensively -- "exit" below assumes the last array element is
    // chronologically last, which isn't guaranteed by either Postgres's
    // unordered result set or the real+live-tail concatenation above.
    const inRange = series.filter((p) => p.date >= w.start && p.date <= w.end).sort((a, b) => a.date.localeCompare(b.date));
    if (inRange.length === 0) return { avgAumCr: null, exitAumCr: null };
    const avgAumCr = inRange.reduce((sum, p) => sum + p.aum, 0) / inRange.length;
    const exitAumCr = inRange[inRange.length - 1].aum;
    return { avgAumCr, exitAumCr };
  }

  return schemes.map((s) => {
    const series = combinedSeries(s.id);
    const adjustedNav = navBySchemeId.get(s.id) ?? [];
    const nav1 = navOnOrBefore(adjustedNav, window1.end);
    const nav2 = navOnOrBefore(adjustedNav, window2.end);
    const priceOnlyPct = nav1 != null && nav2 != null && nav1 !== 0 ? nav2 / nav1 - 1 : null;
    return {
      schemeId: s.id,
      window1: figuresForWindow(series, window1),
      window2: figuresForWindow(series, window2),
      priceOnlyPct,
    };
  });
}
