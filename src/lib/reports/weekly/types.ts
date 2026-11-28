// The Saturday "AMC Weekly Update": what it's built from (the AMC Analytics
// tab's own GET payloads), the figures it shows, and the commentary slots.

import type { StockCorrelationDefaults } from "../../amc-stock/correlation-defaults";
import type { AmcStockCorrelationEntry } from "../../amc-stock/correlation-summary";
import type { SavedFitView } from "../../amc-stock/fit-section-inputs";
import type { RangeOption } from "../../aum/date-range";
import type { AmcAnalyticsInputs } from "../../aum/amc-analytics-inputs";
import type { AmcScoreCard } from "../../aum/amc-score";
import type { ValuationSeriesPoint } from "../../valuation/target-price-inputs";
import type { ValuationMethodKey } from "../../valuation/target-price";
import type { ValuationWeights } from "../../valuation/valuation-settings";

/** The production GET payloads the report is computed from (AMC Analytics' sources only). */
export interface RawReportInputs {
  listed: { id: number; slug: string; overviewName: string }[];
  /** /api/amc-stock-correlations with Nippon's gold/silver blend, as the tab shows it by default. */
  correlations: { amcs: AmcStockCorrelationEntry[]; defaults: StockCorrelationDefaults; computedAt?: string };
  /** /api/aum-history-range: every AMC's equity AUM plus the "Industry Total" row, by day. */
  industryRange: { date: string; amcName: string; liveAumCr: number | null; reportedAumCr: number | null }[];
  /** /api/amc-analytics/target-year. */
  targetFy: number;
  /** /api/industry-monthly-flows. */
  flows: { monthEndDate: string; sipContributionsCr: number | null; equityNetFlowsCr: number | null }[];
  /** /api/sip-quarterly. */
  sipQuarterly: { slug: string; anchor: { fy: number; q: number } | null; quarters: Record<string, { sipCr: number | null; sipEqAumPct: number | null }> }[];
  /** Per AMC: /api/amc-analytics/inputs, /api/amc-valuation, /api/amc-analytics/amc-score. */
  perAmc: Record<string, { inputs: AmcAnalyticsInputs; valuation: { points: ValuationSeriesPoint[] }; score: { card: AmcScoreCard | null } }>;
}

export interface Win {
  label: string;
  value: number | null;
  days: number;
}

export interface Bands {
  bear: number | null;
  base: number | null;
  bull: number | null;
}

export interface AmcWeekly {
  slug: string;
  short: string;
  company: string;
  tradingSymbol: string;
  /** Nippon's AUM includes its gold/silver ETFs (the tab's default blend). */
  blended: boolean;
  aum: {
    qCur: Win;
    qPrev: Win;
    qYoy: Win;
    mCur: Win;
    mPrev: Win;
    mYoy: Win | null;
    qoq: number | null;
    yoy: number | null;
    mom: number | null;
    mYoyChg: number | null;
    /** The last 9 quarters' average daily AUM, oldest first. */
    quarterly: Win[];
    last5: number | null;
    prev5: number | null;
    last20: number | null;
    last45: number | null;
    wow: number | null;
    last5Vs45: number | null;
    /** Current quarter if the current month's average holds for the sessions left. */
    projectedQuarter: number | null;
    projectedQoq: number | null;
    /** Daily AUM from the previous quarter's last session (the index base) to the as-of date. */
    daily: { date: string; value: number }[];
    /** Latest AUM ÷ AUM on the previous quarter's last session − 1 (same base as the price). */
    sinceQuarterStart: number | null;
    /** Lowest / highest point of the AUM index (base = 100) this quarter. */
    indexLow: { date: string; value: number } | null;
    indexHigh: { date: string; value: number } | null;
  };
  share: {
    /** Equity-only AUM ÷ industry equity AUM, quarterly averages (quarters with AMC data). */
    quarters: { label: string; share: number }[];
    qoqBps: number | null;
    last5: number | null;
    /** AMC QoQ − industry QoQ (equity only), in fraction points. */
    growthVsIndustry: number | null;
  };
  sip: { quarters: { key: string; label: string; sipCr: number | null; sipEqAumPct: number | null }[]; qoq: number | null; yoy: number | null } | null;
  score: { latest: number | null; latestLabel: string | null; vs1yAgo: number | null } | null;
  price: {
    close: number | null;
    closeDate: string | null;
    weekAgoClose: number | null;
    weekChg: number | null;
    quarterStartDate: string | null;
    quarterStartClose: number | null;
    sinceQuarterStart: number | null;
    indexLow: { date: string; value: number } | null;
    indexHigh: { date: string; value: number } | null;
    /** (1 + price change) ÷ (1 + AUM change) − 1 since the previous quarter's last session. */
    vsAum: number | null;
    /** Close indexed to the previous quarter's last close = 100. */
    indexed: { date: string; value: number }[];
  };
  ratio: {
    levels: { sd: number; ratio: number; price: number; vsPrice: number | null }[];
    zScore: number | null;
    fairValue: number | null;
    /** Mean-ratio price ÷ close − 1: the ratio's upside. */
    meanVsPrice: number | null;
    gap: number | null;
    corr: number | null;
    r2: number | null;
    sessions: number | null;
  } | null;
  regression: {
    model: "levels" | "pct-change";
    target: number | null;
    vsPrice: number | null;
    corr: number | null;
    r2: number | null;
  } | null;
  earnings: {
    /** PAT (₹ Cr) by fiscal year, FY26 to the target year. */
    pat: Record<number, number | null>;
    shares: number | null;
    epsTargetFy: number | null;
    peNow: number | null;
    /** Mean and SD of the trailing PE over the band charts' default window (`peRange`). */
    peMean: number | null;
    peSd: number | null;
    peZ: number | null;
  };
  targets: {
    methods: Record<ValuationMethodKey, Bands & { upside: number | null; share: number | null }>;
    average: Bands;
    upside: Bands;
    /** No PAT estimate saved: PE and Mcap/Sales drop out. */
    noPat: boolean;
  };
}

export interface WeeklyReportData {
  version: 1;
  asOf: string;
  weekEnding: string;
  generatedAt: string;
  sourceComputedAt: string | null;
  targetFy: number;
  weights: ValuationWeights;
  fitView: SavedFitView;
  /** The PE band window the earnings table's mean / SD / Z use (the dashboard chart's default). */
  peRange: RangeOption;
  quarter: { label: string; prevLabel: string; yoyLabel: string; sessions: number; sessionsLeft: number; startDate: string; endDate: string };
  month: { label: string; prevLabel: string };
  industry: {
    quarters: Win[];
    qoq: number | null;
    yoy: number | null;
    mCur: number | null;
    mPrev: number | null;
    mom: number | null;
    last5: number | null;
    prev5: number | null;
    wow: number | null;
    projectedQoq: number | null;
    /** Industry equity AUM since the previous quarter's last session, daily and as a change. */
    daily: { date: string; value: number }[];
    sinceQuarterStart: number | null;
    /** AMC Analytics' Industry SIP graph in YoY % mode: the last `months` months with mean ±SD (population). */
    sipYoy: {
      months: number;
      points: { month: string; yoy: number }[];
      mean: number | null;
      sd: number | null;
      current: number | null;
      currentMonth: string | null;
      z: number | null;
    } | null;
  };
  flows: { month: string; sipCr: number | null; equityNetCr: number | null }[];
  amcs: AmcWeekly[];
  /** The latest vendor report period imported, e.g. "2026-10". */
  reportedThrough: string | null;
  nextWeek: { from: string; to: string; items: { date: string | null; title: string; detail: string }[] };
  /** Threshold events this week (takeaway slot 7 prefers these), worked out in code. */
  alerts: { kind: "below-bear" | "above-bull" | "pe-z" | "sip-z" | "share-move"; amc: string | null; text: string; ref: string }[];
  warnings: string[];
}

export type CommentarySection = "aum" | "aumPath" | "pricePath" | "share" | "flows" | "week" | "ratio" | "regression" | "earnings" | "targets";

export interface CommentaryBullet {
  /** Bold lead, e.g. "Motilal keeps gaining." */
  lead: string;
  text: string;
  /** figures.json paths for every number in the bullet (for the checker). */
  refs?: string[];
}

export interface WeeklyCommentary {
  takeaways: CommentaryBullet[];
  sections: Partial<Record<CommentarySection, CommentaryBullet[]>>;
  nextWeek?: CommentaryBullet[];
  /** Written by `report stamp`; `hash` covers the figures and this commentary's text. */
  check?: { verdict: "pass" | "fail"; checkedAt: string; hash?: string; notes?: string };
}
