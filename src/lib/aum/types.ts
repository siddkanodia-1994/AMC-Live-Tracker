// "last_close" = DHAN didn't provide a live price (market closed, expired
// token, rate limit, ...) but we have a known good price from the most
// recent successful pricing of this ISIN, so it's used instead of falling
// all the way back to the stale reported value.
export type PriceSource = "live" | "foreign_live" | "last_close" | "not_priceable" | "stale_fallback";

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
  // Identifying keys behind holdingsCount/debtInstrumentCount/livePricedCount,
  // for computing a de-duplicated count across an arbitrary subset of AMCs
  // client-side (e.g. the Overview table's "Total (Top N)" row) the same way
  // LiveAumSnapshot's distinctHoldingsCount etc. do industry-wide -- a stock
  // held by several of the shown AMCs should count once, not once per AMC.
  distinctHoldingIsins: string[];
  distinctDebtKeys: string[];
  distinctLivePricedIsins: string[];
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
  // Fixed rolling-90-calendar-day averages (last 90 days, and the 90 days
  // before that) -- unlike avgLiveAumCr above (anchored to the current
  // report period's month-end), these two are a constant-width window that
  // slides forward every day. Powers the Overview page's "Average Industry
  // Equity AUM (last 90 days)" summary card; null until this AMC has at
  // least one canonical snapshot in the respective window.
  avgLiveAumCr90d: number | null;
  avgLiveAumCrPrev90d: number | null;
  // Overview table-only fields, populated client-side by amc-grid.tsx's
  // adjustedAmcs overlay (never by computeLiveAum/computeOverviewAsOf) --
  // optional so every other AmcLiveAum construction site is unaffected.
  // currentQuarterAvgLiveAumCr: average daily Live AUM over the "Avg Live
  // AUM" column's window (default: current fiscal quarter to date).
  // avgAumQoQChangePct: currentQuarterAvgLiveAumCr / avgLiveAumCr - 1,
  // wherever avgLiveAumCr currently resolves to (default or overridden).
  currentQuarterAvgLiveAumCr?: number | null;
  avgAumQoQChangePct?: number | null;
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
  // netFlowCr / netFlowPriorPeriodReportedAumCr (NOT netFlowBaselineCr) --
  // matches getAumGrowthComparison's "Net Flow %" denominator exactly, so
  // the Overview table and the AUM Growth tab never show two different
  // percentages for the same underlying flow amount.
  netFlowPct: number | null;
  netFlowPriorPeriod: string | null;
  netFlowPriorPeriodReportedAumCr: number | null;
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
  // Distinct ISINs that were priced successfully before (a stored prior
  // close exists) but got NO live price this run — the live-coverage-
  // regression signal. 0 whenever DHAN coverage is fully intact; benign
  // never-priceable holdings don't count here. Meaningful only while
  // pricesAreLive (on non-trading days everything falls back to last close
  // by design).
  distinctLastCloseCount: number;
  // The calendar date (IST) the shown prices actually reflect. Equals
  // today's date when pricesAreLive; otherwise the last real trading day's
  // date (see lastTradingDayIstString) — lets the UI show "Prices as of
  // {date}'s close" without doing its own date/timezone math client-side.
  priceAsOfDate: string;
  // Whether this computation attempted a fresh DHAN fetch at all (true on
  // any trading day, even one where DHAN itself failed) vs. deliberately
  // skipped it because today isn't a trading day. Drives whether the UI
  // shows a ticking "Updated Xs ago" or a stable "As of {date}'s close".
  pricesAreLive: boolean;
  // Set on /api/live-aum responses. null = live mode (real-time DHAN
  // repricing); a date = historical mode, where every AMC shows its
  // canonical daily snapshot on or before that date instead (see
  // computeOverviewAsOf). min/maxSnapshotDate bound the Overview's
  // historical date picker. Optional because computeLiveAum itself doesn't
  // populate them — the route layer does.
  asOfDate?: string | null;
  minSnapshotDate?: string | null;
  maxSnapshotDate?: string | null;
  // Resolved bounds of the two rolling-90-day windows behind
  // AmcLiveAum.avgLiveAumCr90d/avgLiveAumCrPrev90d -- so the client can
  // render an exact date range without redoing "today minus N days" math.
  // Not populated in historical (asOfDate) mode, matching avgLiveAumCr90d
  // itself being null there.
  last90Start?: string;
  last90End?: string;
  prev90Start?: string;
  prev90End?: string;
}

export interface ComputedLiveAum {
  snapshot: LiveAumSnapshot;
  holdingsByAmcId: Map<number, HoldingLiveView[]>;
}
