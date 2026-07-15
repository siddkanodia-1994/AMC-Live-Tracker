import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, amcs, appSettings, holdings } from "../db/schema";
import { getAvailableReportPeriods } from "./aum-growth";
import { NoDataImportedError } from "./compute-live-aum";

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";

export interface SectoralHoldingsAmc {
  amcId: number;
  slug: string;
  overviewName: string;
  reportedAumCr: number;
}

export interface SectoralHoldingsResult {
  reportPeriod: string;
  availableReportPeriods: string[];
  // Every distinct raw `holdings.sector` label for the resolved period,
  // unfiltered (includes debt/repo/cash-adjacent labels like "G-Sec",
  // "Others", "Miscellaneous" alongside genuine industry sectors -- a
  // holding's contribution is grouped by whatever sector string it's
  // literally tagged with, no reclassification). Sorted by total industry
  // value (summed across all AMCs) descending -- this is both the default
  // display order and the ranking used for the Top-N sector selector.
  sectors: string[];
  amcs: SectoralHoldingsAmc[];
  // matrix[sector][amcId] = fraction of that AMC's reportedAumCr held in
  // that sector (0.125 = 12.5%). Absent entries mean the AMC holds nothing
  // in that sector -- treat as 0 on read.
  matrix: Record<string, Record<number, number>>;
}

async function getCurrentReportPeriod(): Promise<string> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, CURRENT_REPORT_PERIOD_KEY));
  if (!row) throw new NoDataImportedError();
  return row.value;
}

/**
 * Sector x AMC allocation matrix for a given report period (defaults to
 * current): what fraction of each AMC's reported AUM sits in each sector.
 * Pure DB reads, no live pricing involved -- reportedAumCr comes straight
 * from that period's own amcPeriods row, so any past month can be browsed
 * the same way as the current one (unlike computeLiveAum, which only ever
 * knows about the current period).
 */
export async function getSectoralHoldings(reportPeriod?: string): Promise<SectoralHoldingsResult> {
  const availableReportPeriods = await getAvailableReportPeriods();
  const resolvedPeriod =
    reportPeriod && availableReportPeriods.includes(reportPeriod) ? reportPeriod : await getCurrentReportPeriod();

  const [amcRows, holdingRows] = await Promise.all([
    db
      .select({ amcId: amcPeriods.amcId, slug: amcs.slug, overviewName: amcs.overviewName, reportedAumCr: amcPeriods.reportedAumCr })
      .from(amcPeriods)
      .innerJoin(amcs, eq(amcPeriods.amcId, amcs.id))
      .where(eq(amcPeriods.reportPeriod, resolvedPeriod)),
    db
      .select({ amcId: holdings.amcId, sector: holdings.sector, marketValueCr: holdings.marketValueCr })
      .from(holdings)
      .where(eq(holdings.reportPeriod, resolvedPeriod)),
  ]);

  const amcList: SectoralHoldingsAmc[] = amcRows.map((amc) => ({
    amcId: amc.amcId,
    slug: amc.slug,
    overviewName: amc.overviewName,
    reportedAumCr: Number(amc.reportedAumCr),
  }));
  const reportedAumByAmcId = new Map(amcList.map((a) => [a.amcId, a.reportedAumCr]));

  // sector -> amcId -> sum(marketValueCr)
  const valueBySectorAndAmc = new Map<string, Map<number, number>>();
  // sector -> total value across all AMCs, for the default/Top-N ranking
  const totalValueBySector = new Map<string, number>();

  for (const h of holdingRows) {
    const valueCr = Number(h.marketValueCr);
    const byAmc = valueBySectorAndAmc.get(h.sector) ?? new Map<number, number>();
    byAmc.set(h.amcId, (byAmc.get(h.amcId) ?? 0) + valueCr);
    valueBySectorAndAmc.set(h.sector, byAmc);
    totalValueBySector.set(h.sector, (totalValueBySector.get(h.sector) ?? 0) + valueCr);
  }

  const sectors = [...totalValueBySector.keys()].sort(
    (a, b) => (totalValueBySector.get(b) ?? 0) - (totalValueBySector.get(a) ?? 0)
  );

  const matrix: Record<string, Record<number, number>> = {};
  for (const sector of sectors) {
    const byAmc = valueBySectorAndAmc.get(sector)!;
    const row: Record<number, number> = {};
    for (const [amcId, valueCr] of byAmc) {
      const reportedAumCr = reportedAumByAmcId.get(amcId);
      if (reportedAumCr) row[amcId] = valueCr / reportedAumCr;
    }
    matrix[sector] = row;
  }

  return { reportPeriod: resolvedPeriod, availableReportPeriods, sectors, amcs: amcList, matrix };
}
