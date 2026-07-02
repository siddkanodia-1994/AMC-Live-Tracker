export type PriceSource = "live" | "foreign_live" | "not_priceable" | "stale_fallback";

export interface HoldingLiveView {
  id: number;
  companyName: string;
  isin: string | null;
  sector: string;
  mcapClassification: string | null;
  shares: number;
  weightPct: number;
  reportedMarketValueCr: number;
  livePriceInr: number | null;
  liveMarketValueCr: number;
  priceSource: PriceSource;
}

export interface AmcLiveAum {
  amcId: number;
  slug: string;
  overviewName: string;
  reportPeriod: string;
  reportedAumCr: number;
  liveAumCr: number;
  deltaCr: number;
  deltaPct: number;
  residualPlugCr: number;
  holdingsCount: number;
  debtInstrumentCount: number;
  livePricedCount: number;
  stalePricedCount: number;
  avgLiveAumCr: number | null;
  avgVsReportedPct: number | null;
  avgWindowDays: number;
}

export type DhanStatus = "ok" | "degraded" | "unavailable";

export interface LiveAumSnapshot {
  amcs: AmcLiveAum[];
  totalLiveAumCr: number;
  totalReportedAumCr: number;
  reportPeriod: string;
  computedAt: string;
  dhanStatus: DhanStatus;
  // De-duplicated by ISIN across all 56 AMCs — NOT a sum of each AMC's
  // holdingsCount, which would count e.g. a stock held by 50 AMCs 50 times.
  // Always industry-wide (not affected by the Overview page's search filter).
  distinctHoldingsCount: number;
  distinctDebtInstrumentCount: number;
  distinctLivePricedCount: number;
}

export interface ComputedLiveAum {
  snapshot: LiveAumSnapshot;
  holdingsByAmcId: Map<number, HoldingLiveView[]>;
}
