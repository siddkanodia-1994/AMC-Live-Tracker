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
  // Most recent prior day's closing price for this ISIN, and the % change
  // from it to today's livePriceInr — null if never priced before (new
  // listing, or this ISIN has no live price today either). Value % change
  // equals price % change since shares are constant between report periods.
  previousClosePriceInr: number | null;
  oneDayChangePct: number | null;
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
  // Live value of this AMC's cash/repo/debt line items (isCashEquivalent /
  // isBankDebtOrRepo) -- always equal to their reported value in practice,
  // since these instrument types are never DHAN-priceable. Powers both the
  // AMC detail page's cards and the Cash Holdings page's "Computed" column,
  // so both stay consistent with a single classification pass.
  cashEquivalentCr: number;
  bankDebtRepoCr: number;
  avgLiveAumCr: number | null;
  avgVsReportedPct: number | null;
  avgWindowDays: number;
  // Most recent prior day's closing live AUM, and the % change from it to
  // today's liveAumCr — null if no prior-day snapshot exists yet (e.g. a
  // brand-new AMC). May span more than 1 calendar day if collection had a gap.
  previousDayLiveAumCr: number | null;
  oneDayChangePct: number | null;
  // Estimated net flow for this report period vs. the prior period's holdings
  // repriced through this period's month-end (see getNetFlowForPeriod) — null
  // until a prior period exists AND its daily-snapshot backfill has run.
  // Conflates genuine investor subscriptions/redemptions with the fund
  // manager's own trading activity — an approximation, not a pure flows figure.
  netFlowCr: number | null;
  netFlowPct: number | null;
  netFlowPriorPeriod: string | null;
  netFlowBaselineCr: number | null;
}

export type DhanStatus = "ok" | "degraded" | "unavailable";

export interface LiveAumSnapshot {
  amcs: AmcLiveAum[];
  totalLiveAumCr: number;
  totalReportedAumCr: number;
  reportPeriod: string;
  computedAt: string;
  dhanStatus: DhanStatus;
  // The specific reason the last DHAN call failed (expired token, rate limit,
  // network error), when known — null if every DHAN call succeeded, or if
  // dhanStatus reflects only benign per-instrument gaps (e.g. an illiquid
  // stock DHAN just doesn't have a quote for) rather than a call-level error.
  // Prefer this over dhanStatus's generic per-state banner text when present,
  // since it's the true cause rather than a guess.
  dhanErrorDetail: string | null;
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
