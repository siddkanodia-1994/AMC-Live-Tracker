import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { etfSchemes, etfExitAumAnchor, etfDailyAumEstimate } from "../db/schema";
import { fetchFullNavHistory } from "./tigzig-client";
import { adjustNavForSplits } from "./nav-split-detection";
import type { NavPoint } from "./historical-backfill";
import { getIstDateString } from "../utils/date";
import { getFiscalYearAndQuarter } from "../aum/report-period";

export interface DetailedExportDayRow {
  date: string;
  quarterLabel: string;
  // anchorStartDate/anchorEndDate/anchorAumCr: which real CRISIL-anchored
  // segment this day belongs to, and that segment's own real end-anchor
  // AUM -- exposed (not just used internally) so the Excel export can key
  // its SUMIFS/segment-boundary formulas off these same values rather than
  // re-deriving them.
  anchorStartDate: string;
  anchorEndDate: string;
  anchorAumCr: number;
  dailyAumCr: number;
  dailyNav: number | null;
  // NAV(this day) / NAV(previous day) - 1 -- null only for the single
  // earliest day in a scheme's entire history (no prior day to compare
  // against at all).
  navReturnPct: number | null;
  priceOnlyAumCr: number;
  // The Modified-Dietz "forward-compounding factor" for this day (how much
  // a flow invested at this day's end grows by the segment's own end
  // date) -- 1.0 on the segment's own last (latest) day, built backward
  // from there. Exposed so Daily Flow can be reconstructed in Excel as
  // (anchorAumCr - priceOnlyAumCr-at-segment-end) / SUM(this column over
  // the segment), matching historical-backfill.ts's own algorithm exactly.
  forwardFactor: number;
  dailyFlowCr: number;
  quarterAvgAumCr: number;
}

export interface DetailedExportSchemeBlock {
  schemeId: number;
  schemeName: string;
  assetClass: "gold" | "silver";
  rows: DetailedExportDayRow[]; // descending by date, latest first
}

export interface DetailedExportAmcGroup {
  overviewName: string;
  gold: DetailedExportSchemeBlock | null;
  silver: DetailedExportSchemeBlock | null;
}

interface SchemeInfo {
  id: number;
  name: string;
  schemeCode: number;
  amc: string;
  assetClass: "gold" | "silver";
}

function fiscalQuarterLabel(dateStr: string): string {
  const { fy, q } = getFiscalYearAndQuarter(dateStr);
  return `Q${q}FY${String(fy).slice(-2)}`;
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
 * One scheme's full daily detail -- every real, Modified-Dietz-reconciled
 * day from `etf_daily_aum_estimate` (rawCompoundedAumCr = price-only,
 * dailyFlowCr = the segment's own solved constant) PLUS the still-open
 * current quarter's live NAV-only tail (price-only AUM equals the daily
 * AUM itself there, dailyFlowCr = 0, since no flow is assumed for an open
 * quarter anywhere else in this feature either). `allAnchorsByDate` maps
 * every real anchor date -> its own exitAumCr for this scheme (not just
 * the latest), needed to label every historical segment's own
 * anchorAumCr, and `firstAnchor` (the scheme's very first real anchor,
 * chronologically) seeds the single earliest day's roll-forward, which
 * has no prior day of its own to reference.
 */
function buildSchemeDetailRows(
  realRows: { snapshotDate: string; estimatedAumCr: string; rawCompoundedAumCr: string; dailyFlowCr: string; anchorStartDate: string; anchorEndDate: string }[],
  lastAnchor: { anchorDate: string; exitAumCr: string } | undefined,
  allAnchorsByDate: Map<string, number>,
  adjustedNav: NavPoint[],
  today: string
): DetailedExportDayRow[] {
  const navByDate = new Map(adjustedNav.map((p) => [p.date, p.nav]));
  const navReturnByDate = new Map<string, number | null>();
  for (let i = 0; i < adjustedNav.length; i++) {
    if (i === 0) {
      navReturnByDate.set(adjustedNav[i].date, null);
      continue;
    }
    const prevNav = adjustedNav[i - 1].nav;
    navReturnByDate.set(adjustedNav[i].date, prevNav !== 0 ? adjustedNav[i].nav / prevNav - 1 : null);
  }
  function navReturnFor(date: string): number | null {
    return navReturnByDate.get(date) ?? null;
  }

  type Base = Omit<DetailedExportDayRow, "quarterAvgAumCr" | "forwardFactor">;
  const rows: Base[] = realRows.map((r) => ({
    date: r.snapshotDate,
    quarterLabel: fiscalQuarterLabel(r.snapshotDate),
    anchorStartDate: r.anchorStartDate,
    anchorEndDate: r.anchorEndDate,
    anchorAumCr: allAnchorsByDate.get(r.anchorEndDate) ?? Number(r.estimatedAumCr),
    dailyAumCr: Number(r.estimatedAumCr),
    dailyNav: navByDate.get(r.snapshotDate) ?? null,
    navReturnPct: navReturnFor(r.snapshotDate),
    priceOnlyAumCr: Number(r.rawCompoundedAumCr),
    dailyFlowCr: Number(r.dailyFlowCr),
  }));

  // Live tail: any day with real NAV data past the last persisted real row
  // (an open, not-yet-closed segment) -- same "no flow assumed" principle
  // used throughout this feature (see daily-series.ts). Labeled with the
  // same lastAnchor as its "segment" so the Excel formulas treat it
  // uniformly (a segment whose dailyFlowCr genuinely solves to 0).
  if (lastAnchor) {
    const lastRealDate = rows.length > 0 ? rows[rows.length - 1].date : lastAnchor.anchorDate;
    const anchorNav = navOnOrBefore(adjustedNav, lastAnchor.anchorDate);
    if (anchorNav != null) {
      for (const p of adjustedNav) {
        if (p.date <= lastRealDate || p.date > today) continue;
        const aum = Number(lastAnchor.exitAumCr) * (p.nav / anchorNav);
        rows.push({
          date: p.date,
          quarterLabel: fiscalQuarterLabel(p.date),
          anchorStartDate: lastAnchor.anchorDate,
          anchorEndDate: p.date, // each live-tail day "closes" its own open-ended mini segment -- no later real anchor exists yet
          anchorAumCr: aum,
          dailyAumCr: aum,
          dailyNav: p.nav,
          navReturnPct: navReturnFor(p.date),
          priceOnlyAumCr: aum,
          dailyFlowCr: 0,
        });
      }
    }
  }

  rows.sort((a, b) => a.date.localeCompare(b.date)); // ascending for forward-factor construction below

  // Forward-compounding factor: 1.0 on a segment's own latest day, then
  // built backward (f(k) = f(k+1) * r(k+1)) -- walking the ascending array
  // in reverse visits latest-to-earliest within each segment naturally.
  const forwardFactors = new Array<number>(rows.length);
  for (let i = rows.length - 1; i >= 0; i--) {
    const isSegmentTop = i === rows.length - 1 || rows[i].anchorEndDate !== rows[i + 1].anchorEndDate;
    forwardFactors[i] = isSegmentTop ? 1 : forwardFactors[i + 1] * (1 + (rows[i + 1].navReturnPct ?? 0));
  }

  const quarterAvgByLabel = new Map<string, number>();
  for (const label of new Set(rows.map((r) => r.quarterLabel))) {
    const inQuarter = rows.filter((r) => r.quarterLabel === label);
    quarterAvgByLabel.set(label, inQuarter.reduce((sum, r) => sum + r.dailyAumCr, 0) / inQuarter.length);
  }

  return rows
    .map((r, i) => ({ ...r, forwardFactor: forwardFactors[i], quarterAvgAumCr: quarterAvgByLabel.get(r.quarterLabel)! }))
    .sort((a, b) => b.date.localeCompare(a.date)); // back to descending, latest first
}

/**
 * Top N schemes of one asset class, ranked by their own latest real
 * Exit AUM anchor (stable -- doesn't fluctuate with today's live price the
 * way a "current live AUM" ranking would).
 */
async function getTopSchemesByAssetClass(assetClass: "gold" | "silver", topN: number): Promise<SchemeInfo[]> {
  const schemes = await db
    .select({ id: etfSchemes.id, name: etfSchemes.name, schemeCode: etfSchemes.schemeCode, amc: etfSchemes.amc, assetClass: etfSchemes.assetClass })
    .from(etfSchemes)
    .where(eq(etfSchemes.assetClass, assetClass));
  const latestAnchors = await db
    .select({ schemeId: etfExitAumAnchor.schemeId, exitAumCr: etfExitAumAnchor.exitAumCr })
    .from(etfExitAumAnchor)
    .where(inArray(etfExitAumAnchor.schemeId, schemes.map((s) => s.id)))
    .orderBy(desc(etfExitAumAnchor.anchorDate));
  const latestBySchemeId = new Map<number, number>();
  for (const r of latestAnchors) {
    if (!latestBySchemeId.has(r.schemeId)) latestBySchemeId.set(r.schemeId, Number(r.exitAumCr));
  }
  return schemes
    .filter((s) => latestBySchemeId.has(s.id))
    .sort((a, b) => latestBySchemeId.get(b.id)! - latestBySchemeId.get(a.id)!)
    .slice(0, topN) as SchemeInfo[];
}

/**
 * The full export dataset: top-5 Gold + top-5 Silver AMCs (ranked
 * independently, de-duplicated by AMC), one group per AMC with BOTH its
 * Gold and Silver scheme detail (whichever it has) even if only one of the
 * two rankings picked it -- more complete than showing just the half that
 * triggered inclusion, and matches how the Overview-format table already
 * always shows both asset classes per AMC row.
 */
export async function getDetailedExportData(topN = 5): Promise<DetailedExportAmcGroup[]> {
  const [topGold, topSilver] = await Promise.all([getTopSchemesByAssetClass("gold", topN), getTopSchemesByAssetClass("silver", topN)]);

  const amcNames = [...new Set([...topGold.map((s) => s.amc), ...topSilver.map((s) => s.amc)])];
  const allSchemesForTheseAmcs = (await db
    .select({ id: etfSchemes.id, name: etfSchemes.name, schemeCode: etfSchemes.schemeCode, amc: etfSchemes.amc, assetClass: etfSchemes.assetClass })
    .from(etfSchemes)
    .where(inArray(etfSchemes.amc, amcNames))) as SchemeInfo[];

  const schemeIds = allSchemesForTheseAmcs.map((s) => s.id);
  const [realRowsAll, allAnchorsAll] = await Promise.all([
    db
      .select({
        schemeId: etfDailyAumEstimate.schemeId,
        snapshotDate: etfDailyAumEstimate.snapshotDate,
        estimatedAumCr: etfDailyAumEstimate.estimatedAumCr,
        rawCompoundedAumCr: etfDailyAumEstimate.rawCompoundedAumCr,
        dailyFlowCr: etfDailyAumEstimate.dailyFlowCr,
        anchorStartDate: etfDailyAumEstimate.anchorStartDate,
        anchorEndDate: etfDailyAumEstimate.anchorEndDate,
      })
      .from(etfDailyAumEstimate)
      .where(inArray(etfDailyAumEstimate.schemeId, schemeIds))
      .orderBy(asc(etfDailyAumEstimate.snapshotDate)),
    db
      .select({ schemeId: etfExitAumAnchor.schemeId, anchorDate: etfExitAumAnchor.anchorDate, exitAumCr: etfExitAumAnchor.exitAumCr })
      .from(etfExitAumAnchor)
      .where(inArray(etfExitAumAnchor.schemeId, schemeIds))
      .orderBy(desc(etfExitAumAnchor.anchorDate)),
  ]);

  const realRowsBySchemeId = new Map<number, typeof realRowsAll>();
  for (const r of realRowsAll) {
    if (!realRowsBySchemeId.has(r.schemeId)) realRowsBySchemeId.set(r.schemeId, []);
    realRowsBySchemeId.get(r.schemeId)!.push(r);
  }
  const lastAnchorBySchemeId = new Map<number, (typeof allAnchorsAll)[number]>();
  const allAnchorsByDateBySchemeId = new Map<number, Map<string, number>>();
  for (const r of allAnchorsAll) {
    if (!lastAnchorBySchemeId.has(r.schemeId)) lastAnchorBySchemeId.set(r.schemeId, r);
    if (!allAnchorsByDateBySchemeId.has(r.schemeId)) allAnchorsByDateBySchemeId.set(r.schemeId, new Map());
    allAnchorsByDateBySchemeId.get(r.schemeId)!.set(r.anchorDate, Number(r.exitAumCr));
  }

  const today = getIstDateString();
  let earliestDate = today;
  for (const s of allSchemesForTheseAmcs) {
    const real = realRowsBySchemeId.get(s.id);
    const anchor = lastAnchorBySchemeId.get(s.id);
    const schemeEarliest = real?.[0]?.snapshotDate ?? anchor?.anchorDate;
    if (schemeEarliest && schemeEarliest < earliestDate) earliestDate = schemeEarliest;
  }

  // One batched live TigZig call across every scheme in the export, rather
  // than one call per scheme -- fewer round trips, more considerate of a
  // free third-party API. This export is an on-demand, occasional action,
  // so a full-history live fetch here is fine (not the "polled every 45s"
  // concern the live-tail read path elsewhere was fixed for).
  const navMap = await fetchFullNavHistory(
    allSchemesForTheseAmcs.map((s) => s.schemeCode),
    earliestDate,
    today
  );
  const adjustedNavBySchemeId = new Map<number, NavPoint[]>();
  for (const s of allSchemesForTheseAmcs) {
    const raw = navMap.get(s.schemeCode) ?? [];
    adjustedNavBySchemeId.set(s.id, raw.length > 0 ? adjustNavForSplits(raw).adjusted : []);
  }

  const groups: DetailedExportAmcGroup[] = [];
  for (const overviewName of amcNames) {
    const gold = allSchemesForTheseAmcs.find((s) => s.amc === overviewName && s.assetClass === "gold");
    const silver = allSchemesForTheseAmcs.find((s) => s.amc === overviewName && s.assetClass === "silver");
    const goldRows = gold
      ? buildSchemeDetailRows(realRowsBySchemeId.get(gold.id) ?? [], lastAnchorBySchemeId.get(gold.id), allAnchorsByDateBySchemeId.get(gold.id) ?? new Map(), adjustedNavBySchemeId.get(gold.id) ?? [], today)
      : null;
    const silverRows = silver
      ? buildSchemeDetailRows(realRowsBySchemeId.get(silver.id) ?? [], lastAnchorBySchemeId.get(silver.id), allAnchorsByDateBySchemeId.get(silver.id) ?? new Map(), adjustedNavBySchemeId.get(silver.id) ?? [], today)
      : null;
    groups.push({
      overviewName,
      gold: gold && goldRows ? { schemeId: gold.id, schemeName: gold.name, assetClass: "gold", rows: goldRows } : null,
      silver: silver && silverRows ? { schemeId: silver.id, schemeName: silver.name, assetClass: "silver", rows: silverRows } : null,
    });
  }
  return groups;
}
