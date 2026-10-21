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
  dailyAumCr: number;
  dailyNav: number | null;
  priceOnlyAumCr: number;
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
 * quarter anywhere else in this feature either). Takes the scheme's own
 * already-fetched, split-adjusted NAV series -- callers batch the live
 * TigZig fetch across every scheme in the export in one call, rather than
 * one call per scheme.
 */
function buildSchemeDetailRows(
  realRows: { snapshotDate: string; estimatedAumCr: string; rawCompoundedAumCr: string; dailyFlowCr: string }[],
  lastAnchor: { anchorDate: string; exitAumCr: string } | undefined,
  adjustedNav: NavPoint[],
  today: string
): DetailedExportDayRow[] {
  const navByDate = new Map(adjustedNav.map((p) => [p.date, p.nav]));

  const rows: Omit<DetailedExportDayRow, "quarterAvgAumCr">[] = realRows.map((r) => ({
    date: r.snapshotDate,
    quarterLabel: fiscalQuarterLabel(r.snapshotDate),
    dailyAumCr: Number(r.estimatedAumCr),
    dailyNav: navByDate.get(r.snapshotDate) ?? null,
    priceOnlyAumCr: Number(r.rawCompoundedAumCr),
    dailyFlowCr: Number(r.dailyFlowCr),
  }));

  // Live tail: any day with real NAV data past the last persisted real row
  // (an open, not-yet-closed segment) -- same "no flow assumed" principle
  // used throughout this feature (see daily-series.ts).
  if (lastAnchor) {
    const lastRealDate = rows.length > 0 ? rows[rows.length - 1].date : lastAnchor.anchorDate;
    const anchorNav = navOnOrBefore(adjustedNav, lastAnchor.anchorDate);
    if (anchorNav != null) {
      for (const p of adjustedNav) {
        if (p.date <= lastRealDate || p.date > today) continue;
        const aum = Number(lastAnchor.exitAumCr) * (p.nav / anchorNav);
        rows.push({ date: p.date, quarterLabel: fiscalQuarterLabel(p.date), dailyAumCr: aum, dailyNav: p.nav, priceOnlyAumCr: aum, dailyFlowCr: 0 });
      }
    }
  }

  const quarterAvgByLabel = new Map<string, number>();
  for (const label of new Set(rows.map((r) => r.quarterLabel))) {
    const inQuarter = rows.filter((r) => r.quarterLabel === label);
    quarterAvgByLabel.set(label, inQuarter.reduce((sum, r) => sum + r.dailyAumCr, 0) / inQuarter.length);
  }

  return rows
    .map((r) => ({ ...r, quarterAvgAumCr: quarterAvgByLabel.get(r.quarterLabel)! }))
    .sort((a, b) => b.date.localeCompare(a.date)); // descending, latest first
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
  const [realRowsAll, lastAnchorsAll] = await Promise.all([
    db
      .select({ schemeId: etfDailyAumEstimate.schemeId, snapshotDate: etfDailyAumEstimate.snapshotDate, estimatedAumCr: etfDailyAumEstimate.estimatedAumCr, rawCompoundedAumCr: etfDailyAumEstimate.rawCompoundedAumCr, dailyFlowCr: etfDailyAumEstimate.dailyFlowCr })
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
  const lastAnchorBySchemeId = new Map<number, (typeof lastAnchorsAll)[number]>();
  for (const r of lastAnchorsAll) {
    if (!lastAnchorBySchemeId.has(r.schemeId)) lastAnchorBySchemeId.set(r.schemeId, r);
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
    const goldRows = gold ? buildSchemeDetailRows(realRowsBySchemeId.get(gold.id) ?? [], lastAnchorBySchemeId.get(gold.id), adjustedNavBySchemeId.get(gold.id) ?? [], today) : null;
    const silverRows = silver ? buildSchemeDetailRows(realRowsBySchemeId.get(silver.id) ?? [], lastAnchorBySchemeId.get(silver.id), adjustedNavBySchemeId.get(silver.id) ?? [], today) : null;
    groups.push({
      overviewName,
      gold: gold && goldRows ? { schemeId: gold.id, schemeName: gold.name, assetClass: "gold", rows: goldRows } : null,
      silver: silver && silverRows ? { schemeId: silver.id, schemeName: silver.name, assetClass: "silver", rows: silverRows } : null,
    });
  }
  return groups;
}
