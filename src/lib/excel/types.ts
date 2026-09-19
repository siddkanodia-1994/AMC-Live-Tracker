export interface OverviewRow {
  overviewName: string;
  reportedAumCr: number;
  prevReportedAumCr: number;
  changeMomPct: number;
  changeCr: number;
}

export interface ParsedHolding {
  companyName: string;
  sector: string;
  mcapClassification: string | null;
  isin: string | null;
  isPriceable: boolean;
  marketValueCr: number;
  shares: number;
  weightPct: number;
  prevMarketValueCr: number;
  prevShares: number;
  prevWeightPct: number;
  changeMarketValueCr: number;
  changeShares: number;
  changeWeightPct: number;
}

export interface ParsedAmcSheet {
  sheetName: string;
  equityAumHeaderCr: number | null;
  incomeDebtAumCr: number | null;
  prevIncomeDebtAumCr: number | null;
  otherFundsAumCr: number | null;
  prevOtherFundsAumCr: number | null;
  holdings: ParsedHolding[];
  sheetTotalHoldingsValueCr: number;
  warnings: string[];
}

export interface AmcNameMapEntry {
  overviewName: string;
  sheetName: string;
  slug: string;
}

export interface ImportResult {
  reportPeriod: string;
  amcsImported: number;
  holdingsImported: number;
  cceRowsImported: number;
  warnings: string[];
  // The id of the importLog row this call inserted -- callers that need to
  // later record a follow-up outcome (e.g. the auto-reclaim after a genuine
  // period advance) update this exact row rather than guessing which is latest.
  importLogId: number;
  // True only when this import advanced current_report_period to a period
  // STRICTLY newer than whatever it was before (not just >=, which a same-
  // period re-upload also satisfies) -- see import-workbook.ts's own
  // forward-only-advance logic, computed at the same point so it can't drift.
  advancedToNewPeriod: boolean;
}
