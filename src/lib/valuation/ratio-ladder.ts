import type { AumHistoryPoint, AmcStockPricePoint } from "../aum/history";
import { filterByRange, type RangeOption } from "../aum/date-range";
import { computeMovingAverage, priceToAumRatioStats, trimToLastContinuousRun } from "../aum/series-math";

// The AMC Analytics Regression section's Ratio Analysis ladder. Built with
// the SAME pipeline as AumTrendChart's Ratio view (smooth over the full
// history, then range-filter, then align AUM/price by date), so the ladder
// always equals the bands drawn under it for any Range / Moving avg /
// AUM-only-avg choice. With AUM-only avg on (raw price) this is also the
// regression engine's ratio stats -- the Valuation Model's Ratio row.

export interface RatioLadder {
  meanRatio: number;
  stdDev: number;
  n: number;
  currentRatio: number;
  zScore: number | null;
  /** Today's (last aligned day's) AUM, averaged over the Moving avg. */
  aumCr: number;
  from: string;
  to: string;
}

export const RATIO_LADDER_SDS = [2, 1, 0, -1, -2] as const;

export function computeRatioLadder(
  aumHistory: AumHistoryPoint[],
  stockPriceSeries: AmcStockPricePoint[],
  opts: { maDays: number; range: RangeOption; aumOnlyAveraging: boolean }
): RatioLadder | null {
  const data = trimToLastContinuousRun(aumHistory);
  const aumMa = computeMovingAverage(
    data.map((d) => d.liveAumCr),
    opts.maDays
  );
  const priceDisplay = opts.aumOnlyAveraging
    ? stockPriceSeries.map((p) => p.priceInr)
    : computeMovingAverage(
        stockPriceSeries.map((p) => p.priceInr),
        opts.maDays
      );
  const priceByDate = new Map<string, number>();
  stockPriceSeries.forEach((p, i) => {
    const v = priceDisplay[i];
    if (v !== undefined) priceByDate.set(p.date, v);
  });
  const points = filterByRange(
    data.map((d, i) => ({ date: d.date, aum: aumMa[i], price: priceByDate.get(d.date) })),
    opts.range
  );
  const dates: string[] = [];
  const aum: number[] = [];
  const price: number[] = [];
  for (const p of points) {
    if (p.aum !== undefined && p.price !== undefined) {
      dates.push(p.date);
      aum.push(p.aum);
      price.push(p.price);
    }
  }
  const stats = priceToAumRatioStats(aum, price);
  const last = aum.length - 1;
  if (!stats || last < 0 || aum[last] === 0) return null;
  const currentRatio = price[last] / aum[last];
  return {
    meanRatio: stats.meanRatio,
    stdDev: stats.stdDev,
    n: stats.n,
    currentRatio,
    zScore: stats.stdDev !== 0 ? (currentRatio - stats.meanRatio) / stats.stdDev : null,
    aumCr: aum[last],
    from: dates[0],
    to: dates[last],
  };
}
