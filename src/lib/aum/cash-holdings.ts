import { db } from "../db/client";
import { officialCceHistory } from "../db/schema";
import { computeLiveAum } from "./compute-live-aum";

export interface CashHoldingsRow {
  amcId: number;
  slug: string;
  overviewName: string;
  historyByMonth: Record<string, number | null>;
  computedPct: number | null;
  reportedAumCr: number;
}

export interface CashHoldingsResult {
  months: string[];
  currentPeriod: string;
  rows: CashHoldingsRow[];
}

/**
 * Industry-wide Cash & Cash Equivalent % of AUM, month by month, sourced
 * from the workbook's official "Cash Holdings" sheet (see
 * scripts/import-cash-holdings-history.ts) plus a "Computed" column derived
 * live from our own classification (isCashEquivalent / isBankDebtOrRepo,
 * see compute-live-aum.ts) for the current report period, as a cross-check
 * against the official figure. Both cashEquivalentCr and bankDebtRepoCr are
 * always at their reported value (never DHAN-priced), so computedPct is
 * stable intraday, not something that drifts with live prices.
 */
export async function getCashHoldingsHistory(): Promise<CashHoldingsResult> {
  const [historyRows, snapshot] = await Promise.all([
    db
      .select({ amcId: officialCceHistory.amcId, month: officialCceHistory.month, ccePct: officialCceHistory.ccePct })
      .from(officialCceHistory),
    computeLiveAum(),
  ]);

  const months = [...new Set(historyRows.map((r) => r.month))].sort();

  const historyByAmcId = new Map<number, Record<string, number>>();
  for (const r of historyRows) {
    const record = historyByAmcId.get(r.amcId) ?? {};
    record[r.month] = Number(r.ccePct);
    historyByAmcId.set(r.amcId, record);
  }

  const rows: CashHoldingsRow[] = snapshot.amcs.map((amc) => {
    const record = historyByAmcId.get(amc.amcId) ?? {};
    const historyByMonth: Record<string, number | null> = {};
    for (const month of months) {
      historyByMonth[month] = record[month] ?? null;
    }
    const computedPct = amc.reportedAumCr !== 0 ? (amc.cashEquivalentCr + amc.bankDebtRepoCr) / amc.reportedAumCr : null;

    return {
      amcId: amc.amcId,
      slug: amc.slug,
      overviewName: amc.overviewName,
      historyByMonth,
      computedPct,
      reportedAumCr: amc.reportedAumCr,
    };
  });

  return { months, currentPeriod: snapshot.reportPeriod, rows };
}
