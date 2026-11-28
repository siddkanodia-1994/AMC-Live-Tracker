// The AMC Analytics Valuation Model's settings and Target Price inputs, apart
// from the component so the weekly report builds the exact same table.

import type { StockCorrelationDefaults } from "../amc-stock/correlation-defaults";
import type { AmcStockCorrelationEntry } from "../amc-stock/correlation-summary";
import type { RangeOption } from "../aum/date-range";
import { withLiveValuationPoint } from "./provisional";
import type { TargetPriceInputs, TargetPriceManual } from "./target-price";
import { DEFAULT_BEST_FIT_AUM_DAYS, DEFAULT_BEST_FIT_AUM_PCT, DEFAULT_VALUATION_RATIO_DAYS, DEFAULT_VALUATION_WEIGHTS, type ValuationWeights } from "./valuation-settings";

export interface ValuationSettings {
  ratioRange: RangeOption;
  ratioHistoryDays: number;
  ratioTodayDays: number;
  bestFitRange: RangeOption;
  bestFitMaDays: number;
  bestFitAumDays: number;
  bestFitAumPct: number;
  /** Each AMC's typed AUM (₹ Cr) for the Custom choice. */
  ratioCustomAum: Record<string, number>;
  bestFitCustomAum: Record<string, number>;
  /** The Average's weight (%) per method, shared like the rest. */
  weights: ValuationWeights;
}

/** The settings the Valuation Model uses: unsaved picks over the saved defaults over the built-in ones. */
export function resolveValuationSettings(defaults: StockCorrelationDefaults | undefined, local: Partial<ValuationSettings> = {}): ValuationSettings {
  return {
    ratioRange: local.ratioRange ?? defaults?.valuationRatioRange ?? "3y",
    ratioHistoryDays: local.ratioHistoryDays ?? defaults?.valuationRatioHistoryDays ?? DEFAULT_VALUATION_RATIO_DAYS,
    ratioTodayDays: local.ratioTodayDays ?? defaults?.valuationRatioDays ?? DEFAULT_VALUATION_RATIO_DAYS,
    bestFitRange: local.bestFitRange ?? defaults?.bestFitRange ?? "3y",
    bestFitMaDays: local.bestFitMaDays ?? defaults?.bestFitMaDays ?? DEFAULT_VALUATION_RATIO_DAYS,
    bestFitAumDays: local.bestFitAumDays ?? defaults?.bestFitAumDays ?? DEFAULT_BEST_FIT_AUM_DAYS,
    bestFitAumPct: local.bestFitAumPct ?? defaults?.bestFitAumPct ?? DEFAULT_BEST_FIT_AUM_PCT,
    ratioCustomAum: { ...defaults?.valuationRatioCustomAum, ...local.ratioCustomAum },
    bestFitCustomAum: { ...defaults?.bestFitCustomAum, ...local.bestFitCustomAum },
    weights: local.weights ?? defaults?.valuationWeights ?? DEFAULT_VALUATION_WEIGHTS,
  };
}

/** The Valuation Model's PE / Mcap-Sales series point (from /api/amc-valuation). */
export interface ValuationSeriesPoint {
  date: string;
  pe: number | null;
  mcapToSales: number | null;
  provisional?: boolean;
}

/** Everything computeTargetPrices needs, assembled exactly as the Valuation Model does. */
export function buildTargetPriceInputs({
  entry,
  defaults,
  settings,
  manual,
  valuationPoints,
  cmpInr,
}: {
  entry: AmcStockCorrelationEntry;
  defaults: StockCorrelationDefaults;
  settings: ValuationSettings;
  /** The stored inputs with the target year's PAT and revenue (manualForTargetYear). */
  manual: TargetPriceManual;
  valuationPoints: ValuationSeriesPoint[];
  cmpInr: number | null;
}): TargetPriceInputs {
  return {
    aumHistory: entry.aumHistory,
    stockPriceSeries: entry.stockPriceSeries,
    ratioRange: settings.ratioRange,
    ratioHistoryDays: settings.ratioHistoryDays,
    ratioTodayDays: settings.ratioTodayDays,
    ratioCustomAumCr: settings.ratioCustomAum[entry.slug] ?? null,
    bestFitCustomAumCr: settings.bestFitCustomAum[entry.slug] ?? null,
    bestFitRange: settings.bestFitRange,
    bestFitMaDays: settings.bestFitMaDays,
    extraLagDays: defaults.extraLagDays,
    bestFitAumDays: settings.bestFitAumDays,
    bestFitAumPct: settings.bestFitAumPct,
    manual,
    mcapSalesSeries: withLiveValuationPoint(valuationPoints, entry.stockPriceSeries.at(-1), entry.stockPriceSeries).flatMap((p) =>
      p.mcapToSales === null ? [] : [{ date: p.date, value: p.mcapToSales }]
    ),
    cmpInr,
    weights: settings.weights,
  };
}
