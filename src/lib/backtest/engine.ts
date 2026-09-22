// TypeScript port of backtesting/signals.py + backtesting/engine.py (the
// offline Python tool, already hand-verified against real data -- see
// that folder). This module is what makes the live Backtest tab safe:
// it takes data the page already fetched once (AmcDetailView's own
// `history`/`stockPriceSeries` props) and does every computation
// client-side, so changing a config control never triggers a DB query.
import type { AumHistoryPoint, AmcStockPricePoint } from "@/lib/aum/history";

export interface AlignedPoint {
  date: string;
  price: number;
  aumCr: number;
}

// Inner-joins the two raw (unsmoothed) daily series by date -- only days
// with BOTH a real price and AUM value, same rule aum-trend-chart.tsx's
// alignedRatioInputs uses for its own (period-filtered, moving-averaged)
// version. Kept as its own small function here rather than sharing that
// one: this needs RAW daily values (the backtest computes its own
// rolling stats), that one needs already-smoothed chart data -- different
// input shapes, and reusing the shipped/tested chart's own memo isn't
// worth the risk of touching it for this.
export function alignAumPriceSeries(history: AumHistoryPoint[], priceSeries: AmcStockPricePoint[]): AlignedPoint[] {
  const priceByDate = new Map(priceSeries.map((p) => [p.date, p.priceInr]));
  const points: AlignedPoint[] = [];
  for (const h of history) {
    const price = priceByDate.get(h.date);
    if (price === undefined || price <= 0 || h.liveAumCr <= 0) continue;
    points.push({ date: h.date, price, aumCr: h.liveAumCr });
  }
  return points;
}

export interface RollingPoint extends AlignedPoint {
  ratio: number;
  rollingMean: number | undefined;
  rollingStd: number | undefined;
  zscore: number | undefined;
}

// Walk-forward: every point's mean/std only ever looks at the trailing
// `lookbackDays`, recomputed fresh per point, so a day's Z-score never
// uses information from a later day. Uses SAMPLE std (N-1 denominator) --
// matches pandas' `Series.rolling(window).std()` default, which is what
// backtesting/signals.py actually calls. Deliberately NOT the same as
// priceToAumRatioStats (population std, N) used elsewhere in this app for
// the unrelated static Z-score column on the Stock Correlation table --
// getting this wrong would silently break parity with the already-
// verified Python tool.
export function computeRollingZScore(points: AlignedPoint[], lookbackDays: number): RollingPoint[] {
  const ratios = points.map((p) => p.price / p.aumCr);
  const result: RollingPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    let rollingMean: number | undefined;
    let rollingStd: number | undefined;
    let zscore: number | undefined;
    if (lookbackDays >= 2 && i >= lookbackDays - 1) {
      const window = ratios.slice(i - lookbackDays + 1, i + 1);
      const mean = window.reduce((a, b) => a + b, 0) / window.length;
      const variance = window.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (window.length - 1);
      const std = Math.sqrt(variance);
      rollingMean = mean;
      rollingStd = std;
      zscore = std !== 0 ? (ratios[i] - mean) / std : undefined;
    }
    result.push({ ...points[i], ratio: ratios[i], rollingMean, rollingStd, zscore });
  }
  return result;
}

export type ExitRule = "fixed_holding" | "mean_revert" | "combo";
export type PositionSizing = "equal_weight" | "fixed_capital";

export interface BacktestConfig {
  lookbackDays: number;
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

function findExit(points: RollingPoint[], entryIdx: number, config: BacktestConfig): { exitIdx: number; reason: Trade["exitReason"] } {
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

// `points` must already carry rollingMean/rollingStd/zscore (see
// computeRollingZScore). Runs ONE threshold -- call once per configured
// threshold. One open position at a time (a new signal while already in
// a trade is ignored) -- the only sane default for a single-instrument
// long-only mean-reversion backtest.
export function runBacktest(points: RollingPoint[], config: BacktestConfig): BacktestResult {
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
      const entryPrice = points[entryIdx].price;
      const exitPrice = points[exitIdx].price;
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

      trades.push({
        entryDate: points[entryIdx].date,
        entryPrice,
        entryZScore: zscore,
        exitDate: points[exitIdx].date,
        exitPrice,
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
