// The AMC Analytics tab's Valuation Model "Target Price" table: Bear /
// Base / Bull share prices from four methods, plus their Average. Pure --
// every formula is the dashboard's existing one, called rather than copied:
//
//  - Ratio (as of today): the price ÷ N-day-avg equity AUM ratio's own
//    history (mean, population SD -- regression-engine's ratio stats, the
//    same ones Fortnightly's "fair value at mean" uses) applied to today's
//    N-day-avg AUM: −1 SD / Mean / +1 SD. N applies to BOTH sides.
//  - Best fit line (as of today): the Stock Correlation table's regression
//    line (the saved Moving avg, normally 45D) at an N-day-avg AUM
//    (whatIfStartingAum), and at that AUM −/+ x%.
//  - PE: Fortnightly's own computeValuationBlock -- FY28E PAT × target PE ÷
//    shares, discounted two periods ÷ ((1 + FY27 rate)(1 + FY26 rate)).
//  - Mcap / Sales: the identical block with FY28E revenue in place of PAT
//    and the Mcap / Sales multiples in place of the PEs. A multiple left
//    blank falls back to the Mcap / Sales chart's 3Y −1 SD / Mean / +1 SD.
//  - Average: the mean of whichever methods have a value, per scenario.

import { computeRegressionResult, type ExtraLagDays } from "../amc-stock/regression-engine";
import { whatIfStartingAum } from "../amc-stock/aum-what-if";
import { computeValuationBlock, type FortnightlyManualFields } from "../aum/fortnightly-update";
import { trimToLastContinuousRun } from "../aum/series-math";
import { computeRangeCutoffDate, filterByCutoff, type RangeOption } from "../aum/date-range";
import type { AumHistoryPoint, AmcStockPricePoint } from "../aum/history";
import { computeBands } from "./bands";

// The window the Mcap / Sales default multiples' band is read over (the chart's default).
export const MCAP_SALES_BAND_RANGE: RangeOption = "3y";

export interface Scenario {
  bear: number | null;
  base: number | null;
  bull: number | null;
}

export type ScenarioKey = keyof Scenario;
export const SCENARIO_KEYS: ScenarioKey[] = ["bear", "base", "bull"];

export type ValuationMethodKey = "ratio" | "bestFit" | "pe" | "mcapSales";

export interface TargetPriceInputs {
  aumHistory: AumHistoryPoint[];
  stockPriceSeries: AmcStockPricePoint[];
  /** The saved Stock Correlation settings the regression line is fitted with. */
  range: RangeOption;
  maDays: number;
  extraLagDays: number;
  ratioDays: number;
  bestFitAumDays: number;
  bestFitAumPct: number;
  manual: Pick<
    FortnightlyManualFields,
    | "noOfSharesCr"
    | "patFy28eCr"
    | "targetPeBear"
    | "targetPeBase"
    | "targetPeBull"
    | "discountRateFy27Pct"
    | "discountRateFy26Pct"
    | "revenueFy28eCr"
    | "targetMcapSalesBear"
    | "targetMcapSalesBase"
    | "targetMcapSalesBull"
  >;
  /** Daily Mcap / Sales (the band chart's own points, provisional days included). */
  mcapSalesSeries: { date: string; value: number }[];
  /** Current share price -- live in market hours, else the last close. */
  cmpInr: number | null;
}

export interface TargetPriceTable {
  methods: Record<ValuationMethodKey, Scenario>;
  average: Scenario;
  /** How many methods fed each Average cell. */
  averageCount: Record<ScenarioKey, number>;
  upside: Record<ValuationMethodKey | "average", Scenario>;
  /** The AUMs used: the ratio's N-day average and the best-fit's starting AUM. */
  ratioAumCr: number | null;
  bestFitAumCr: number | null;
  /** The Mcap / Sales multiples actually used, and which came from the 3Y band. */
  mcapSalesMultiples: Scenario;
  mcapSalesFromBand: Record<ScenarioKey, boolean>;
  mcapSalesBand: { mean: number; sd: number } | null;
}

const EMPTY: Scenario = { bear: null, base: null, bull: null };

function finiteOrNull(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) ? null : v;
}

function mapScenario(s: Scenario, fn: (v: number) => number | null): Scenario {
  return { bear: s.bear == null ? null : fn(s.bear), base: s.base == null ? null : fn(s.base), bull: s.bull == null ? null : fn(s.bull) };
}

/** The Mcap / Sales chart's 3Y band (sample SD), exactly as the chart computes it. */
export function mcapSalesBand(series: { date: string; value: number }[]): { mean: number; sd: number } | null {
  const rows = filterByCutoff(series, computeRangeCutoffDate(series, MCAP_SALES_BAND_RANGE));
  const b = computeBands(rows.map((r) => r.value));
  return b ? { mean: b.mean, sd: b.sd } : null;
}

export function computeTargetPrices(input: TargetPriceInputs): TargetPriceTable {
  // Ratio: N-day-avg AUM on both sides; same-day pairing, as Fortnightly's ratio.
  const ratioFit = computeRegressionResult(input.aumHistory, input.stockPriceSeries, {
    maWindow: Math.max(1, input.ratioDays),
    extraLagDays: 0 as ExtraLagDays,
    range: input.range,
  });
  const ratioMean = ratioFit?.ratioMean ?? null;
  const ratioSd = ratioFit?.ratioStdDev ?? null;
  // priceAtMeanRatio = mean × today's (unlagged) N-day-avg AUM.
  const ratioAumCr = ratioFit && ratioMean && ratioFit.priceAtMeanRatio !== null ? ratioFit.priceAtMeanRatio / ratioMean : null;
  const ratio: Scenario =
    ratioMean !== null && ratioSd !== null && ratioAumCr !== null
      ? { bear: (ratioMean - ratioSd) * ratioAumCr, base: ratioMean * ratioAumCr, bull: (ratioMean + ratioSd) * ratioAumCr }
      : EMPTY;

  // Best fit: the table's own line, read at the chosen starting AUM.
  const line = computeRegressionResult(input.aumHistory, input.stockPriceSeries, {
    maWindow: input.maDays,
    extraLagDays: input.extraLagDays as ExtraLagDays,
    range: input.range,
  });
  const bestFitAumCr = whatIfStartingAum(
    trimToLastContinuousRun(input.aumHistory).map((d) => d.liveAumCr),
    input.bestFitAumDays
  );
  const k = input.bestFitAumPct / 100;
  const bestFit: Scenario =
    line && bestFitAumCr !== null
      ? {
          bear: line.slope * bestFitAumCr * (1 - k) + line.intercept,
          base: line.slope * bestFitAumCr + line.intercept,
          bull: line.slope * bestFitAumCr * (1 + k) + line.intercept,
        }
      : EMPTY;

  // PE: Fortnightly's block, FY26-discounted stage.
  const m = input.manual;
  const peBlock = computeValuationBlock({ ...nullManual(), ...m }, input.cmpInr);
  const pe = peBlock.fy26DiscountedPriceInr;

  // Mcap / Sales: the same block, revenue for PAT and the multiples for PEs.
  const band = mcapSalesBand(input.mcapSalesSeries);
  const fromBand = {
    bear: m.targetMcapSalesBear == null,
    base: m.targetMcapSalesBase == null,
    bull: m.targetMcapSalesBull == null,
  };
  const multiples: Scenario = {
    bear: m.targetMcapSalesBear ?? (band ? band.mean - band.sd : null),
    base: m.targetMcapSalesBase ?? (band ? band.mean : null),
    bull: m.targetMcapSalesBull ?? (band ? band.mean + band.sd : null),
  };
  const msBlock = computeValuationBlock(
    {
      ...nullManual(),
      ...m,
      patFy28eCr: m.revenueFy28eCr,
      targetPeBear: multiples.bear,
      targetPeBase: multiples.base,
      targetPeBull: multiples.bull,
    },
    input.cmpInr
  );
  const mcapSales = msBlock.fy26DiscountedPriceInr;

  const methods: Record<ValuationMethodKey, Scenario> = {
    ratio: mapScenario(ratio, finiteOrNull),
    bestFit: mapScenario(bestFit, finiteOrNull),
    pe: mapScenario(pe, finiteOrNull),
    mcapSales: mapScenario(mcapSales, finiteOrNull),
  };

  const average = { ...EMPTY };
  const averageCount = { bear: 0, base: 0, bull: 0 };
  for (const key of SCENARIO_KEYS) {
    const values = Object.values(methods)
      .map((s) => s[key])
      .filter((v): v is number => v !== null);
    averageCount[key] = values.length;
    average[key] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }

  const cmp = input.cmpInr;
  const up = (s: Scenario) => mapScenario(s, (v) => (cmp === null || cmp === 0 ? null : v / cmp - 1));
  return {
    methods,
    average,
    averageCount,
    upside: {
      ratio: up(methods.ratio),
      bestFit: up(methods.bestFit),
      pe: up(methods.pe),
      mcapSales: up(methods.mcapSales),
      average: up(average),
    },
    ratioAumCr: finiteOrNull(ratioAumCr),
    bestFitAumCr: finiteOrNull(bestFitAumCr),
    mcapSalesMultiples: multiples,
    mcapSalesFromBand: fromBand,
    mcapSalesBand: band,
  };
}

// computeValuationBlock takes the whole manual-fields shape; only the
// valuation fields matter to it, the rest are null here.
function nullManual(): FortnightlyManualFields {
  return {
    noOfSharesCr: null,
    patFy26aCr: null,
    patFy27eCr: null,
    patFy28eCr: null,
    targetPeBear: null,
    targetPeBase: null,
    targetPeBull: null,
    discountRateFy27Pct: null,
    discountRateFy26Pct: null,
    revenueFy28eCr: null,
    targetMcapSalesBear: null,
    targetMcapSalesBase: null,
    targetMcapSalesBull: null,
    sipAmcQtdValCr: null,
    sipAmcQtdPct: null,
    sipAmcPrevQValCr: null,
    sipAmcPrevQPct: null,
    sipAmcPrevQ2ValCr: null,
    sipAmcPrevQ2Pct: null,
    sipAmcYoyQValCr: null,
    sipAmcYoyQPct: null,
    sipAmcYoyQ2ValCr: null,
    sipAmcYoyQ2Pct: null,
    sipAmcLatestFy: null,
    sipAmcLatestQuarter: null,
    sipIndustryMtdValCr: null,
    sipIndustryPrevMValCr: null,
    sipIndustryPrevM2ValCr: null,
    sipIndustryYoyMValCr: null,
    sipIndustryYoyM2ValCr: null,
    sipIndustryQtrQtdValCr: null,
    sipIndustryQtrPrevQValCr: null,
    sipIndustryQtrPrevQ2ValCr: null,
    sipIndustryQtrYoyQValCr: null,
    sipIndustryQtrYoyQ2ValCr: null,
    amcScoreAnchorDate: null,
    summary: null,
    verdictOverride: null,
    verdictCustomText: null,
  };
}
