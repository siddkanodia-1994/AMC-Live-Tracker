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
  warnings: string[];
}
