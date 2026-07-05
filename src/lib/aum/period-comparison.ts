import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, holdings } from "../db/schema";

export type PeriodComparisonStatus = "held" | "new_entry" | "full_exit";

export interface PeriodComparisonRow {
  key: string;
  isin: string | null;
  companyName: string;
  sector: string;
  mcapClassification: string | null;
  priorShares: number | null;
  currentShares: number | null;
  shareChange: number;
  priorValueCr: number | null;
  currentValueCr: number | null;
  valueChangeCr: number;
  status: PeriodComparisonStatus;
}

export interface PeriodComparisonResult {
  currentPeriod: string;
  priorPeriod: string;
  rows: PeriodComparisonRow[];
}

/**
 * Position-level comparison between an AMC's two most recent report periods
 * — generic over whichever two periods are latest (not hardcoded to any
 * specific months), so this automatically extends as new periods are
 * imported. Joins holdings by ISIN, falling back to lowercased company name
 * for null-ISIN rows (debt/repo line items), same dedup key as the industry-
 * wide debt count in compute-live-aum.ts. Returns null when this AMC has
 * fewer than 2 periods to compare (nothing to diff against yet).
 *
 * Known limitation: a stock the AMC fully exited BEFORE the prior period even
 * started (i.e. absent from both periods' sheets) is invisible here — this
 * only surfaces changes visible across the two periods actually stored.
 */
export async function getPeriodComparison(amcId: number): Promise<PeriodComparisonResult | null> {
  const periodRows = await db
    .selectDistinct({ reportPeriod: amcPeriods.reportPeriod })
    .from(amcPeriods)
    .where(eq(amcPeriods.amcId, amcId))
    .orderBy(desc(amcPeriods.reportPeriod))
    .limit(2);

  if (periodRows.length < 2) return null;
  const currentPeriod = periodRows[0].reportPeriod;
  const priorPeriod = periodRows[1].reportPeriod;

  const holdingRows = await db
    .select()
    .from(holdings)
    .where(and(eq(holdings.amcId, amcId), inArray(holdings.reportPeriod, [currentPeriod, priorPeriod])));

  type HoldingRow = (typeof holdingRows)[number];
  const keyFor = (h: HoldingRow): string => h.isin ?? h.companyName.trim().toLowerCase();

  const currentByKey = new Map<string, HoldingRow>();
  const priorByKey = new Map<string, HoldingRow>();
  for (const h of holdingRows) {
    if (h.reportPeriod === currentPeriod) currentByKey.set(keyFor(h), h);
    else priorByKey.set(keyFor(h), h);
  }

  const allKeys = new Set([...currentByKey.keys(), ...priorByKey.keys()]);
  const rows: PeriodComparisonRow[] = [];
  for (const key of allKeys) {
    const cur = currentByKey.get(key);
    const prior = priorByKey.get(key);
    const identity = (cur ?? prior)!;

    const priorShares = prior ? Number(prior.shares) : null;
    const currentShares = cur ? Number(cur.shares) : null;
    const priorValueCr = prior ? Number(prior.marketValueCr) : null;
    const currentValueCr = cur ? Number(cur.marketValueCr) : null;

    rows.push({
      key,
      isin: identity.isin,
      companyName: identity.companyName,
      sector: identity.sector,
      mcapClassification: identity.mcapClassification,
      priorShares,
      currentShares,
      shareChange: (currentShares ?? 0) - (priorShares ?? 0),
      priorValueCr,
      currentValueCr,
      valueChangeCr: (currentValueCr ?? 0) - (priorValueCr ?? 0),
      status: !prior ? "new_entry" : !cur ? "full_exit" : "held",
    });
  }

  return { currentPeriod, priorPeriod, rows };
}
