// TypeScript port of backtesting/signals.py + backtesting/engine.py (the
// offline Python tool, already hand-verified against real data -- see
// that folder). This module is what makes the live Backtest tab safe:
// it takes data the page already fetched once (AmcDetailView's own
// `history`/`stockPriceSeries` props) and does every computation
// client-side, so changing a config control never triggers a DB query.
//
// Z-score method: an EXPANDING window anchored at the selected Backfill
// period's own start date (not a fixed rolling width) -- a fixed 15-day
// rolling window was found to swing wildly (e.g. -2.43 -> +1.92 over 3
// weeks on HDFC) even when the underlying ratio barely moved, because a
// short window's own reference mean/std is itself noisy. Confirmed with
// the user via several worked examples; see the plan for the full audit.
import type { AumHistoryPoint, AmcStockPricePoint } from "@/lib/aum/history";
import { computeMovingAverage } from "@/lib/aum/series-math";
import { computeRangeCutoffDate, type RangeOption } from "@/lib/aum/date-range";

export interface SmoothedPoint {
  date: string;
  avgPrice: number;
  avgAumCr: number;
  // The actual, transactable price on this date -- entry/exit P&L is
  // computed from this, never from avgPrice. Matches this app's existing
  // precedent (fair-value-explainer.tsx: "Upside % always compares
  // against the RAW current price... not the moving-average-smoothed"
  // one) -- the averaged series drives the ratio/Z-score/signal only.
  rawPrice: number;
}

// Smooths AUM and share price SEPARATELY -- each over its own full raw
// series first (matching aum-trend-chart.tsx's buildChartData/
// alignedRatioInputs pattern: smooth each full series independently,
// THEN intersect by date) -- rather than smoothing an already-joined
// series, since AUM and price history don't always share the exact same
// date coverage. A point only exists once a genuine N-day moving-average
// window exists for BOTH series (computeMovingAverage's own semantics:
// undefined until a real window of real data accumulates, borrowing from
// before any later-applied period cutoff when the AMC's own history
// reaches back that far -- never a partial/incomplete average).
export function alignSmoothedSeries(history: AumHistoryPoint[], priceSeries: AmcStockPricePoint[], maDays: number): SmoothedPoint[] {
  const avgAumByDate = new Map<string, number>();
  const aumDisplay = computeMovingAverage(history.map((h) => h.liveAumCr), maDays);
  history.forEach((h, i) => {
    const v = aumDisplay[i];
    if (v !== undefined && v > 0) avgAumByDate.set(h.date, v);
  });

  const avgPriceByDate = new Map<string, number>();
  const rawPriceByDate = new Map<string, number>();
  const priceDisplay = computeMovingAverage(priceSeries.map((p) => p.priceInr), maDays);
  priceSeries.forEach((p, i) => {
    const v = priceDisplay[i];
    if (v !== undefined) avgPriceByDate.set(p.date, v);
    rawPriceByDate.set(p.date, p.priceInr);
  });

  const points: SmoothedPoint[] = [];
  for (const h of history) {
    const avgAumCr = avgAumByDate.get(h.date);
    const avgPrice = avgPriceByDate.get(h.date);
    const rawPrice = rawPriceByDate.get(h.date);
    if (avgAumCr === undefined || avgPrice === undefined || rawPrice === undefined) continue;
    points.push({ date: h.date, avgPrice, avgAumCr, rawPrice });
  }
  return points;
}

export interface ExpandingZScorePoint extends SmoothedPoint {
  ratio: number;
  mean: number | undefined;
  std: number | undefined;
  zscore: number | undefined;
}

// Mean/SD/Z-score come from an EXPANDING window anchored at `range`'s own
// start date (found the same way every other period selector in this
// app resolves a trailing window -- computeRangeCutoffDate). Walking
// forward from that start, day T's mean/SD use every ratio value from
// the period start through T -- growing every day, never forgetting
// earlier days within the period, and never reset between a trade's
// entry and its later exit. Points before the period start carry no
// Z-score (they only existed to seed the moving average above). Needs
// >= 2 ratio points within the period before a Z-score exists (mirrors
// priceToAumRatioStats' own minimum). Sample std (N-1) -- a fresh
// calculation, not a port of anything with its own convention to match.
//
// Uses Welford's online algorithm for the running mean/variance rather
// than a naive sum-of-squares formula: ratios here are tightly clustered
// small numbers (~0.005-0.03), and an expanding window can grow to
// hundreds of days -- a sum-of-squares shortcut would lose real
// precision to catastrophic cancellation at that scale.
export function computeExpandingZScore(points: SmoothedPoint[], range: RangeOption): ExpandingZScorePoint[] {
  const cutoffDate = computeRangeCutoffDate(points, range);
  const periodStartIdx = cutoffDate === null ? 0 : points.findIndex((p) => p.date >= cutoffDate);

  const result: ExpandingZScorePoint[] = points.map((p) => ({
    ...p,
    ratio: p.avgPrice / p.avgAumCr,
    mean: undefined,
    std: undefined,
    zscore: undefined,
  }));

  if (periodStartIdx === -1) return result;

  let count = 0;
  let mean = 0;
  let m2 = 0;
  for (let i = periodStartIdx; i < result.length; i++) {
    const ratio = result[i].ratio;
    count++;
    const delta = ratio - mean;
    mean += delta / count;
    const delta2 = ratio - mean;
    m2 += delta * delta2;

    if (count >= 2) {
      const variance = m2 / (count - 1);
      const std = Math.sqrt(Math.max(variance, 0));
      result[i].mean = mean;
      result[i].std = std;
      result[i].zscore = std !== 0 ? (ratio - mean) / std : undefined;
    }
  }
  return result;
}

export type ExitRule = "fixed_holding" | "mean_revert" | "combo";
export type PositionSizing = "equal_weight" | "fixed_capital";

export interface BacktestConfig {
  maDays: number;
  threshold: number;
  exitRule: ExitRule;
  holdingDays: number;
  meanRevertTargetZ: number;
  entryLagDays: number;
  transactionCostBps: number;
  initialCapital: number;
  positionSizing: PositionSizing;
  positionSizeFraction: number;
  fixedCapitalPerTrade: number;
}

export interface Trade {
  entryDate: string;
  entryPrice: number;
  entryZScore: number;
  exitDate: string;
  exitPrice: number;
  exitZScore: number;
  exitReason: "fixed_holding" | "mean_revert" | "end_of_data";
  holdingDays: number;
  returnPct: number; // net of transaction costs, as a fraction (0.05 = 5%)
}

export interface EquityPoint {
  date: string;
  equity: number;
}

export interface BacktestResult {
  threshold: number;
  trades: Trade[];
  equityCurve: EquityPoint[];
}

function positionSize(equity: number, config: BacktestConfig): number {
  if (config.positionSizing === "fixed_capital") {
    return Math.min(config.fixedCapitalPerTrade, equity);
  }
  return equity * config.positionSizeFraction;
}

function findExit(points: ExpandingZScorePoint[], entryIdx: number, config: BacktestConfig): { exitIdx: number; reason: Trade["exitReason"] } {
  const n = points.length;
  const fixedExitIdx = Math.min(entryIdx + config.holdingDays, n - 1);

  if (config.exitRule === "fixed_holding") {
    return { exitIdx: fixedExitIdx, reason: "fixed_holding" };
  }

  // mean_revert / combo: scan forward for the first day the Z-score
  // reaches the target. "combo" only accepts a mean-revert exit at or
  // before the fixed-holding deadline; otherwise (or if it never
  // reverts) it falls back to the fixed holding period.
  for (let j = entryIdx + 1; j < n; j++) {
    const z = points[j].zscore;
    if (z !== undefined && z >= config.meanRevertTargetZ) {
      if (config.exitRule === "mean_revert") return { exitIdx: j, reason: "mean_revert" };
      if (j <= fixedExitIdx) return { exitIdx: j, reason: "mean_revert" };
      break;
    }
  }

  if (config.exitRule === "mean_revert") return { exitIdx: n - 1, reason: "end_of_data" };
  return { exitIdx: fixedExitIdx, reason: "fixed_holding" };
}

// `points` must already carry mean/std/zscore (see
// computeExpandingZScore). Runs ONE threshold -- call once per
// configured threshold. One open position at a time (a new signal while
// already in a trade is ignored) -- the only sane default for a
// single-instrument long-only mean-reversion backtest.
export function runBacktest(points: ExpandingZScorePoint[], config: BacktestConfig): BacktestResult {
  const n = points.length;
  const costFrac = config.transactionCostBps / 10_000;

  const trades: Trade[] = [];
  let equity = config.initialCapital;
  const equityCurve: EquityPoint[] = new Array(n);

  let i = 0;
  while (i < n) {
    const zscore = points[i].zscore;

    if (zscore !== undefined && zscore <= config.threshold) {
      const entryIdx = i + config.entryLagDays;
      if (entryIdx >= n) {
        for (let k = i; k < n; k++) equityCurve[k] = { date: points[k].date, equity };
        break;
      }

      const { exitIdx, reason } = findExit(points, entryIdx, config);
      const entryPrice = points[entryIdx].rawPrice;
      const exitPrice = points[exitIdx].rawPrice;
      const grossReturn = (exitPrice - entryPrice) / entryPrice;
      const netReturn = grossReturn - 2 * costFrac; // entry + exit legs

      const size = positionSize(equity, config);
      const pnl = size * netReturn;

      // Flat at pre-trade equity through the signal day and the holding
      // period (no intraday mark-to-market); equity steps to its new
      // value on the exit day itself.
      for (let k = i; k < exitIdx; k++) equityCurve[k] = { date: points[k].date, equity };
      equity += pnl;
      equityCurve[exitIdx] = { date: points[exitIdx].date, equity };

      // Always defined here: exitIdx >= entryIdx > i, and a trade only
      // ever opens where i's own zscore is already defined -- every
      // later index within the same (already-started) expanding window
      // has a zscore too -- TS just can't prove that invariant
      // structurally.
      const exitZScore = points[exitIdx].zscore as number;

      trades.push({
        entryDate: points[entryIdx].date,
        entryPrice,
        entryZScore: zscore,
        exitDate: points[exitIdx].date,
        exitPrice,
        exitZScore,
        exitReason: reason,
        holdingDays: exitIdx - entryIdx,
        returnPct: netReturn,
      });

      i = exitIdx + 1;
      continue;
    }

    equityCurve[i] = { date: points[i].date, equity };
    i++;
  }

  return { threshold: config.threshold, trades, equityCurve };
}
