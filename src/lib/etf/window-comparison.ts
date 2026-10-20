import { db } from "../db/client";
import { etfSchemes, etfExitAumAnchor } from "../db/schema";
import { fetchFullNavHistory } from "./tigzig-client";
import { adjustNavForSplits } from "./nav-split-detection";
import type { NavPoint } from "./historical-backfill";
import { getEtfCombinedDailySeriesBySchemeIds, type EtfDailyPoint } from "./daily-series";
import { sql } from "drizzle-orm";

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

function figuresForWindow(series: EtfDailyPoint[], w: DateWindow): EtfWindowFigures {
  const inRange = series.filter((p) => p.date >= w.start && p.date <= w.end).sort((a, b) => a.date.localeCompare(b.date));
  if (inRange.length === 0) return { avgAumCr: null, exitAumCr: null };
  const avgAumCr = inRange.reduce((sum, p) => sum + p.aum, 0) / inRange.length;
  const exitAumCr = inRange[inRange.length - 1].aum;
  return { avgAumCr, exitAumCr };
}

function navOnOrBefore(adjustedNav: NavPoint[], date: string): number | null {
  let result: number | null = null;
  for (const p of adjustedNav) {
    if (p.date > date) break;
    result = p.nav;
  }
  return result;
}

/**
 * Figures for both comparison windows, per scheme, plus the point-to-point
 * split-adjusted NAV return between the windows' end dates (the "Price QoQ"
 * component the UI subtracts from the total to get "Flow QoQ"). The daily
 * series itself (real + live extrapolated tail for an open quarter) comes
 * from the shared `getEtfCombinedDailySeriesBySchemeIds` -- see that
 * module for the live-extrapolation rationale.
 */
export async function getEtfWindowComparison(window1: DateWindow, window2: DateWindow): Promise<EtfWindowComparisonRow[]> {
  const rangeStart = window1.start < window2.start ? window1.start : window2.start;
  const rangeEnd = window1.end > window2.end ? window1.end : window2.end;

  const schemes = await db.select({ id: etfSchemes.id, schemeCode: etfSchemes.schemeCode }).from(etfSchemes);
  const seriesBySchemeId = await getEtfCombinedDailySeriesBySchemeIds(
    schemes.map((s) => s.id),
    rangeStart,
    rangeEnd
  );

  // Price-only needs raw split-adjusted NAV directly (not the AUM series),
  // since it's a pure price ratio independent of any anchor/flow logic.
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

  return schemes.map((s) => {
    const series = seriesBySchemeId.get(s.id) ?? [];
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
