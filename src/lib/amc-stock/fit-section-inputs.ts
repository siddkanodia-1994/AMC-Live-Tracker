// The settings AMC Analytics' Ratio / Regression / Predictor sections read
// from the saved defaults, and the AUMs and price they apply them to --
// apart from the components so the weekly report reproduces them exactly.

import type { RangeOption } from "../aum/date-range";
import { trimToLastContinuousRun } from "../aum/series-math";
import { DEFAULT_WHAT_IF_AUM_DAYS, whatIfStartingAum } from "./aum-what-if";
import type { StockCorrelationDefaults } from "./correlation-defaults";
import type { AmcStockCorrelationEntry } from "./correlation-summary";
import type { ExtraLagDays, RegressionConfig } from "./regression-engine";

/** Ratio / Regression's saved view (fit* keys), as the sections open on it. */
export interface SavedFitView {
  range: RangeOption;
  maDays: number;
  aumOnlyAveraging: boolean;
  levelsCorrelation: boolean;
}

export function savedFitView(defaults: StockCorrelationDefaults | undefined): SavedFitView {
  return {
    range: defaults?.fitRange ?? "3y",
    maDays: defaults?.fitMaDays ?? 1,
    aumOnlyAveraging: defaults?.fitAumOnlyAveraging ?? false,
    levelsCorrelation: defaults?.fitLevelsCorrelation ?? false,
  };
}

/** The regression the Predictors fit: the shared Stock Correlation range / MA / lag. */
export function savedRegressionConfig(defaults: StockCorrelationDefaults): RegressionConfig {
  return { maWindow: defaults.maDays, extraLagDays: defaults.extraLagDays as ExtraLagDays, range: defaults.range };
}

function dailyAum(entry: AmcStockCorrelationEntry): number[] {
  return trimToLastContinuousRun(entry.aumHistory).map((d) => d.liveAumCr);
}

/** AUM Predictor's starting AUM: the saved N-day average (the what-if days setting). */
export function whatIfDaysOf(defaults: StockCorrelationDefaults): number {
  return defaults.whatIfAumDays ?? DEFAULT_WHAT_IF_AUM_DAYS;
}

export function predictorStartAum(entry: AmcStockCorrelationEntry, whatIfDays: number): number | null {
  return whatIfStartingAum(dailyAum(entry), whatIfDays);
}

/** The AUM a saved default typed for this AMC, if any. */
export function savedPredictorInput(entry: AmcStockCorrelationEntry, defaults: StockCorrelationDefaults): number | null {
  return defaults.aumInputs?.[entry.slug] ?? null;
}

/** Live Predictor's AUM: today's live snapshot when there is one, else the latest stored day. */
export function liveFairValueAum(entry: AmcStockCorrelationEntry, liveAumCr: number | null): number | null {
  return liveAumCr ?? whatIfStartingAum(dailyAum(entry), 0);
}

/** CMP: today's live price when there is one, else the last stored close. */
export function currentPriceOf(entry: AmcStockCorrelationEntry | undefined, livePriceInr: number | null | undefined): number | null {
  return livePriceInr ?? entry?.stockPriceSeries.at(-1)?.priceInr ?? null;
}
