// TypeScript port of backtesting/metrics.py.
import type { BacktestResult } from "./engine";

export interface Metrics {
  threshold: number;
  numTrades: number;
  winRate: number;
  avgReturnPct: number;
  medianReturnPct: number;
  totalCompoundedReturnPct: number;
  maxDrawdownPct: number;
  profitFactor: number;
  sharpeRatio: number;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeMetrics(result: BacktestResult, riskFreeRateAnnual: number): Metrics {
  const { trades, equityCurve, threshold } = result;
  const n = trades.length;

  const equityValues = equityCurve.map((e) => e.equity);
  const totalCompoundedReturn = equityValues.length > 0 ? equityValues[equityValues.length - 1] / equityValues[0] - 1 : 0;

  let runningMax = -Infinity;
  let maxDrawdown = 0;
  for (const e of equityValues) {
    runningMax = Math.max(runningMax, e);
    const drawdown = (e - runningMax) / runningMax;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }

  if (n === 0) {
    return {
      threshold,
      numTrades: 0,
      winRate: NaN,
      avgReturnPct: NaN,
      medianReturnPct: NaN,
      totalCompoundedReturnPct: totalCompoundedReturn,
      maxDrawdownPct: maxDrawdown,
      profitFactor: NaN,
      sharpeRatio: NaN,
    };
  }

  const returns = trades.map((t) => t.returnPct);
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);

  const winRate = wins.length / n;
  const avgReturn = returns.reduce((a, b) => a + b, 0) / n;
  const medianReturn = median([...returns].sort((a, b) => a - b));

  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : NaN;

  // Sharpe off the trade returns themselves (not a daily series, since
  // trades are irregular in time), annualized via the average holding
  // period -- an approximation, not the textbook daily-returns Sharpe.
  // Uses POPULATION std (N denominator) for the excess returns -- matches
  // numpy's `ndarray.std()` default, which is what backtesting/metrics.py
  // actually calls (a plain numpy array, not a pandas Series -- unlike
  // the rolling Z-score's sample std in engine.ts, which mirrors pandas'
  // own default instead). Each one intentionally mirrors its own Python
  // counterpart's actual library default, not a single convention picked
  // for this port.
  const avgHoldingDays = trades.reduce((sum, t) => sum + t.holdingDays, 0) / n;
  const tradesPerYear = avgHoldingDays > 0 ? 252 / avgHoldingDays : NaN;
  const rfPerTrade = tradesPerYear && !Number.isNaN(tradesPerYear) ? riskFreeRateAnnual / tradesPerYear : 0;
  const excess = returns.map((r) => r - rfPerTrade);
  const excessMean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const excessVariance = excess.reduce((sum, r) => sum + (r - excessMean) ** 2, 0) / excess.length;
  const excessStd = Math.sqrt(excessVariance);
  const sharpe = excessStd > 0 && tradesPerYear && !Number.isNaN(tradesPerYear) ? (excessMean / excessStd) * Math.sqrt(tradesPerYear) : NaN;

  return {
    threshold,
    numTrades: n,
    winRate,
    avgReturnPct: avgReturn,
    medianReturnPct: medianReturn,
    totalCompoundedReturnPct: totalCompoundedReturn,
    maxDrawdownPct: maxDrawdown,
    profitFactor,
    sharpeRatio: sharpe,
  };
}
