import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { holdings } from "../db/schema";
import { computeLiveAum } from "./compute-live-aum";

export interface SectoralHoldingsAmc {
  amcId: number;
  slug: string;
  overviewName: string;
  reportedAumCr: number;
}

export interface SectoralHoldingsResult {
  reportPeriod: string;
  // Every distinct raw `holdings.sector` label for the current period,
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

/**
 * Sector x AMC allocation matrix for the current report period: what
 * fraction of each AMC's reported AUM sits in each sector. Current-
 * period-only (matching Cash Holdings' scope), pure DB reads.
 */
export async function getSectoralHoldings(): Promise<SectoralHoldingsResult> {
  const snapshot = await computeLiveAum();
  const holdingRows = await db
    .select({ amcId: holdings.amcId, sector: holdings.sector, marketValueCr: holdings.marketValueCr })
    .from(holdings)
    .where(eq(holdings.reportPeriod, snapshot.reportPeriod));

  const amcs: SectoralHoldingsAmc[] = snapshot.amcs.map((amc) => ({
    amcId: amc.amcId,
    slug: amc.slug,
    overviewName: amc.overviewName,
    reportedAumCr: amc.reportedAumCr,
  }));
  const reportedAumByAmcId = new Map(amcs.map((a) => [a.amcId, a.reportedAumCr]));

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

  return { reportPeriod: snapshot.reportPeriod, sectors, amcs, matrix };
}
