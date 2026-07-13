import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../db/client";
import { amcs, holdings, instrumentMap } from "../db/schema";
import { getAvailableReportPeriods } from "./aum-growth";

export interface StockCandidate {
  isin: string;
  companyName: string;
}

/**
 * Resolves a free-text query (company name, ISIN, or NSE/BSE trading code)
 * to the distinct stocks it matches, searching across every imported period
 * so a query still finds a stock even if only an older period's row happens
 * to contain the matched spelling. ISIN is the canonical identity -- every
 * AMC's own row for the same stock shares one ISIN even when company-name
 * spelling differs slightly between AMCs' sheets, so downstream lookups key
 * off the returned isin, never companyName.
 */
export async function searchStockCandidates(query: string): Promise<StockCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const pattern = `%${trimmed}%`;

  const rows = await db
    .selectDistinctOn([holdings.isin], {
      isin: holdings.isin,
      companyName: holdings.companyName,
    })
    .from(holdings)
    .leftJoin(instrumentMap, eq(holdings.isin, instrumentMap.isin))
    .where(
      and(
        isNotNull(holdings.isin),
        or(ilike(holdings.isin, pattern), ilike(holdings.companyName, pattern), ilike(instrumentMap.tradingSymbol, pattern))
      )
    )
    // DISTINCT ON (isin) keeps the first row per isin in this order -- so
    // each candidate's companyName is that stock's MOST RECENT spelling.
    .orderBy(holdings.isin, desc(holdings.reportPeriod));

  return rows
    .filter((r): r is { isin: string; companyName: string } => r.isin !== null)
    .map((r) => ({ isin: r.isin, companyName: r.companyName }));
}

export interface StockPeriodFigures {
  shares: number;
  marketValueCr: number;
  weightPct: number | null;
}

export interface StockAmcRow {
  amcId: number;
  slug: string;
  overviewName: string;
  sector: string | null;
  mcapClassification: string | null;
  // Keyed by reportPeriod ("2026-06") -- absent for a period this AMC didn't
  // hold the stock in (fully exited before the window opened, or entered
  // after it did).
  byPeriod: Record<string, StockPeriodFigures>;
  // Null when this AMC didn't hold the stock in the most recent of the last
  // 4 periods (i.e. it exited before then) -- shows as "--" in the UI.
  latestMarketValueCr: number | null;
  changeSharesLatest: number | null;
  changeMarketValueCrLatest: number | null;
  // This stock's rank by marketValueCr within the AMC's OWN full portfolio,
  // for the latest period -- null when the AMC didn't hold it that period.
  rankInPortfolio: number | null;
}

export interface StockHoldingResult {
  isin: string;
  companyName: string;
  // Oldest -> newest, up to the last 4 report periods with any imported data.
  periods: string[];
  // Sorted by latestMarketValueCr descending (AMCs that exited before the
  // latest period, with no value there, sort last).
  amcs: StockAmcRow[];
  // Sum of latestMarketValueCr across every returned AMC.
  industryTotalLatestValueCr: number;
  // Sum of shares across every returned AMC, per period -- keyed by
  // reportPeriod, same as StockAmcRow.byPeriod. An AMC absent for a given
  // period (didn't hold the stock that month) contributes 0.
  industryTotalSharesByPeriod: Record<string, number>;
  // Sum of changeSharesLatest/changeMarketValueCrLatest across every
  // returned AMC -- an AMC with no latest-period change (null, e.g. it
  // exited before the latest period) contributes 0.
  industryTotalChangeSharesLatest: number;
  industryTotalChangeMarketValueCrLatest: number;
}

/**
 * Every AMC that held the given ISIN in any of the last 4 imported report
 * periods, with per-period shares/value/weight, the latest period's
 * month-over-month change (already stored per holding row at import time --
 * see holdings.changeShares/changeMarketValueCr), and this stock's rank
 * within each AMC's own portfolio for the latest period. Returns null when
 * no AMC held this ISIN in that 4-period window at all (a stock that was
 * fully divested industry-wide before the window opened).
 */
export async function getStockHoldingsAcrossAmcs(isin: string): Promise<StockHoldingResult | null> {
  const allPeriods = await getAvailableReportPeriods(); // oldest -> newest
  const periods = allPeriods.slice(-4);
  if (periods.length === 0) return null;
  const latestPeriod = periods[periods.length - 1];

  const rows = await db
    .select({
      amcId: holdings.amcId,
      slug: amcs.slug,
      overviewName: amcs.overviewName,
      reportPeriod: holdings.reportPeriod,
      companyName: holdings.companyName,
      sector: holdings.sector,
      mcapClassification: holdings.mcapClassification,
      shares: holdings.shares,
      marketValueCr: holdings.marketValueCr,
      weightPct: holdings.weightPct,
      changeShares: holdings.changeShares,
      changeMarketValueCr: holdings.changeMarketValueCr,
    })
    .from(holdings)
    .innerJoin(amcs, eq(holdings.amcId, amcs.id))
    .where(and(eq(holdings.isin, isin), inArray(holdings.reportPeriod, periods)));

  if (rows.length === 0) return null;

  const latestNameRow = rows.find((r) => r.reportPeriod === latestPeriod) ?? rows[0];

  const byAmc = new Map<number, StockAmcRow>();
  for (const r of rows) {
    let entry = byAmc.get(r.amcId);
    if (!entry) {
      entry = {
        amcId: r.amcId,
        slug: r.slug,
        overviewName: r.overviewName,
        sector: r.sector,
        mcapClassification: r.mcapClassification,
        byPeriod: {},
        latestMarketValueCr: null,
        changeSharesLatest: null,
        changeMarketValueCrLatest: null,
        rankInPortfolio: null,
      };
      byAmc.set(r.amcId, entry);
    }
    entry.byPeriod[r.reportPeriod] = {
      shares: Number(r.shares),
      marketValueCr: Number(r.marketValueCr),
      weightPct: r.weightPct !== null ? Number(r.weightPct) : null,
    };
    if (r.reportPeriod === latestPeriod) {
      // Prefer the freshest classification when this AMC still holds it.
      entry.sector = r.sector;
      entry.mcapClassification = r.mcapClassification;
      entry.latestMarketValueCr = Number(r.marketValueCr);
      entry.changeSharesLatest = r.changeShares !== null ? Number(r.changeShares) : null;
      entry.changeMarketValueCrLatest = r.changeMarketValueCr !== null ? Number(r.changeMarketValueCr) : null;
    }
  }

  const amcIds = [...byAmc.keys()];

  // This stock's rank within each AMC's own full portfolio for the latest
  // period -- computed industry-wide in one windowed query rather than one
  // query per AMC.
  const rankRows = await db
    .select({
      amcId: holdings.amcId,
      isin: holdings.isin,
      rank: sql<number>`rank() over (partition by ${holdings.amcId} order by ${holdings.marketValueCr} desc)`,
    })
    .from(holdings)
    .where(and(eq(holdings.reportPeriod, latestPeriod), inArray(holdings.amcId, amcIds)));

  for (const r of rankRows) {
    if (r.isin === isin) {
      const entry = byAmc.get(r.amcId);
      if (entry) entry.rankInPortfolio = Number(r.rank);
    }
  }

  const amcRows = [...byAmc.values()].sort((a, b) => (b.latestMarketValueCr ?? -1) - (a.latestMarketValueCr ?? -1));
  const industryTotalLatestValueCr = amcRows.reduce((sum, a) => sum + (a.latestMarketValueCr ?? 0), 0);

  const industryTotalSharesByPeriod: Record<string, number> = {};
  for (const period of periods) {
    industryTotalSharesByPeriod[period] = amcRows.reduce((sum, a) => sum + (a.byPeriod[period]?.shares ?? 0), 0);
  }

  const industryTotalChangeSharesLatest = amcRows.reduce((sum, a) => sum + (a.changeSharesLatest ?? 0), 0);
  const industryTotalChangeMarketValueCrLatest = amcRows.reduce((sum, a) => sum + (a.changeMarketValueCrLatest ?? 0), 0);

  return {
    isin,
    companyName: latestNameRow.companyName,
    periods,
    amcs: amcRows,
    industryTotalLatestValueCr,
    industryTotalSharesByPeriod,
    industryTotalChangeSharesLatest,
    industryTotalChangeMarketValueCrLatest,
  };
}
