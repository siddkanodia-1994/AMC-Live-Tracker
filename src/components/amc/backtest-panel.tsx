"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPct, formatPriceInr, formatShortDateWithYear } from "@/lib/utils/format";
import type { AumHistoryPoint, AmcStockPricePoint } from "@/lib/aum/history";
import { RANGE_OPTIONS, filterByRange, type RangeOption } from "@/lib/aum/date-range";
import {
  alignAumPriceSeries,
  computeRollingZScore,
  runBacktest,
  type BacktestConfig,
  type ExitRule,
  type PositionSizing,
} from "@/lib/backtest/engine";
import { computeMetrics } from "@/lib/backtest/metrics";

const segmentActive = "rounded-md bg-foreground px-2 py-1 text-xs text-background";
const segmentInactive = "rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground";
const numberInputClass =
  "w-20 rounded-md border bg-background px-2 py-1 text-xs hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";
const labelClass = "text-xs text-muted-foreground";

const tooltipContentStyle = {
  backgroundColor: "var(--color-popover)",
  borderColor: "var(--color-border)",
  color: "var(--color-popover-foreground)",
  fontSize: 12,
};

function parseThresholds(input: string): number[] {
  const parsed = input
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n));
  return parsed.length > 0 ? parsed : [-1.5, -2.0];
}

interface ReturnBin {
  bin: string;
  count: number;
}

function binReturns(returnsPct: number[], binCount = 12): ReturnBin[] {
  if (returnsPct.length === 0) return [];
  const min = Math.min(...returnsPct);
  const max = Math.max(...returnsPct);
  if (min === max) return [{ bin: min.toFixed(1), count: returnsPct.length }];
  const width = (max - min) / binCount;
  const counts = new Array(binCount).fill(0);
  for (const r of returnsPct) {
    const idx = Math.min(binCount - 1, Math.floor((r - min) / width));
    counts[idx]++;
  }
  return counts.map((count, i) => ({ bin: (min + i * width).toFixed(1), count }));
}

function formatMetricPct(value: number, numTrades: number, alwaysSign = false): string {
  return numTrades > 0 ? formatPct(value, { alwaysSign }) : "—";
}

function formatRatioMetric(value: number): string {
  if (value === Infinity) return "∞";
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

function Stat({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div>
      <div className={labelClass}>{label}</div>
      <div className={`font-mono text-sm font-medium ${valueClassName ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}

/**
 * Live client-side port of the offline Python backtester (see
 * backtesting/ at the project root, which this mirrors exactly -- see
 * src/lib/backtest/engine.ts's parity notes). Renders one AMC's results
 * -- the caller (backtest-page.tsx, the top-level Backtest tab) supplies
 * `history`/`stockPriceSeries` for whichever AMC is currently selected in
 * its own dropdown. Every config change here recomputes entirely in the
 * browser, no DB query, no server call.
 */
export function BacktestPanel({
  history,
  stockPriceSeries,
  stockLabel,
}: {
  history: AumHistoryPoint[];
  stockPriceSeries?: AmcStockPricePoint[];
  stockLabel?: string;
}) {
  const [range, setRange] = useState<RangeOption>("3y");
  const [thresholdsInput, setThresholdsInput] = useState("-1.5, -2.0");
  const [lookbackDaysInput, setLookbackDaysInput] = useState("15");
  const [exitRule, setExitRule] = useState<ExitRule>("combo");
  const [holdingDaysInput, setHoldingDaysInput] = useState("20");
  const [meanRevertTargetZInput, setMeanRevertTargetZInput] = useState("0");
  const [entryLagDaysInput, setEntryLagDaysInput] = useState("1");
  const [transactionCostBpsInput, setTransactionCostBpsInput] = useState("10");
  const [initialCapitalInput, setInitialCapitalInput] = useState("1000000");
  const [positionSizing, setPositionSizing] = useState<PositionSizing>("equal_weight");
  const [positionSizeFractionInput, setPositionSizeFractionInput] = useState("100");
  const [fixedCapitalPerTradeInput, setFixedCapitalPerTradeInput] = useState("100000");

  const hasStockPrice = !!stockPriceSeries && stockPriceSeries.length > 0;

  const lookbackDays = Math.max(2, Math.min(250, parseInt(lookbackDaysInput, 10) || 15));
  const holdingDays = Math.max(1, Math.min(250, parseInt(holdingDaysInput, 10) || 20));
  const entryLagDays = Math.max(1, Math.min(30, parseInt(entryLagDaysInput, 10) || 1));
  const transactionCostBps = Math.max(0, parseFloat(transactionCostBpsInput) || 0);
  const initialCapital = Math.max(1, parseFloat(initialCapitalInput) || 1_000_000);
  const meanRevertTargetZ = parseFloat(meanRevertTargetZInput) || 0;
  const positionSizeFraction = Math.max(0, Math.min(100, parseFloat(positionSizeFractionInput) || 100)) / 100;
  const fixedCapitalPerTrade = Math.max(1, parseFloat(fixedCapitalPerTradeInput) || 100_000);
  const thresholds = useMemo(() => parseThresholds(thresholdsInput), [thresholdsInput]);

  // Rolling Z-score computed over the FULL (unranged) history first, so a
  // day near the start of the selected period still gets a genuine
  // trailing lookback from just-before-the-window data, instead of an
  // artificial warm-up gap right where the window begins -- same
  // full-history-then-filter convention AumTrendChart/StockCorrelationTable
  // already use for their own moving averages.
  const rolling = useMemo(() => {
    if (!hasStockPrice) return [];
    const aligned = alignAumPriceSeries(history, stockPriceSeries!);
    return computeRollingZScore(aligned, lookbackDays);
  }, [history, stockPriceSeries, hasStockPrice, lookbackDays]);

  const rangedRolling = useMemo(() => filterByRange(rolling, range), [rolling, range]);

  const resultsByThreshold = useMemo(() => {
    if (rangedRolling.length < lookbackDays) return [];
    return thresholds.map((threshold) => {
      const config: BacktestConfig = {
        lookbackDays,
        threshold,
        exitRule,
        holdingDays,
        meanRevertTargetZ,
        entryLagDays,
        transactionCostBps,
        initialCapital,
        positionSizing,
        positionSizeFraction,
        fixedCapitalPerTrade,
      };
      const result = runBacktest(rangedRolling, config);
      const metrics = computeMetrics(result, 0);
      return { result, metrics };
    });
  }, [
    rangedRolling,
    lookbackDays,
    thresholds,
    exitRule,
    holdingDays,
    meanRevertTargetZ,
    entryLagDays,
    transactionCostBps,
    initialCapital,
    positionSizing,
    positionSizeFraction,
    fixedCapitalPerTrade,
  ]);

  if (!hasStockPrice) return null;

  return (
    <div className="space-y-4">
      <details className="rounded-lg border bg-card p-4" open>
        <summary className="cursor-pointer text-sm font-medium text-foreground">Backtest configuration</summary>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Backfill period</span>
            <div className="flex items-center gap-1" role="group" aria-label="Backfill period">
              {RANGE_OPTIONS.map((o) => (
                <button key={o.value} type="button" onClick={() => setRange(o.value)} className={o.value === range ? segmentActive : segmentInactive}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="bt-thresholds" className={labelClass}>
              Z-score thresholds (comma-separated)
            </label>
            <input
              id="bt-thresholds"
              type="text"
              value={thresholdsInput}
              onChange={(e) => setThresholdsInput(e.target.value)}
              className="w-40 rounded-md border bg-background px-2 py-1 text-xs hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="bt-lookback" className={labelClass}>
              Lookback (days)
            </label>
            <input id="bt-lookback" type="number" min={2} max={250} value={lookbackDaysInput} onChange={(e) => setLookbackDaysInput(e.target.value)} className={numberInputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Exit rule</span>
            <div className="flex items-center gap-1" role="group" aria-label="Exit rule">
              {(
                [
                  { value: "fixed_holding", label: "Fixed holding" },
                  { value: "mean_revert", label: "Mean-revert" },
                  { value: "combo", label: "Combo" },
                ] as const
              ).map((o) => (
                <button key={o.value} type="button" onClick={() => setExitRule(o.value)} className={exitRule === o.value ? segmentActive : segmentInactive}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {exitRule !== "mean_revert" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="bt-holding-days" className={labelClass}>
                Holding days
              </label>
              <input id="bt-holding-days" type="number" min={1} max={250} value={holdingDaysInput} onChange={(e) => setHoldingDaysInput(e.target.value)} className={numberInputClass} />
            </div>
          )}
          {exitRule !== "fixed_holding" && (
            <div className="flex flex-col gap-1">
              <label htmlFor="bt-target-z" className={labelClass}>
                Mean-revert target Z
              </label>
              <input id="bt-target-z" type="number" step="0.1" value={meanRevertTargetZInput} onChange={(e) => setMeanRevertTargetZInput(e.target.value)} className={numberInputClass} />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor="bt-entry-lag" className={labelClass}>
              Entry lag (days)
            </label>
            <input id="bt-entry-lag" type="number" min={1} max={30} value={entryLagDaysInput} onChange={(e) => setEntryLagDaysInput(e.target.value)} className={numberInputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="bt-cost-bps" className={labelClass}>
              Cost per leg (bps)
            </label>
            <input id="bt-cost-bps" type="number" min={0} value={transactionCostBpsInput} onChange={(e) => setTransactionCostBpsInput(e.target.value)} className={numberInputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="bt-capital" className={labelClass}>
              Initial capital (₹)
            </label>
            <input
              id="bt-capital"
              type="number"
              min={1}
              value={initialCapitalInput}
              onChange={(e) => setInitialCapitalInput(e.target.value)}
              className="w-28 rounded-md border bg-background px-2 py-1 text-xs hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Position sizing</span>
            <div className="flex items-center gap-1" role="group" aria-label="Position sizing">
              <button type="button" onClick={() => setPositionSizing("equal_weight")} className={positionSizing === "equal_weight" ? segmentActive : segmentInactive}>
                Equal weight
              </button>
              <button type="button" onClick={() => setPositionSizing("fixed_capital")} className={positionSizing === "fixed_capital" ? segmentActive : segmentInactive}>
                Fixed capital
              </button>
            </div>
          </div>
          {positionSizing === "equal_weight" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="bt-size-fraction" className={labelClass}>
                % of equity per trade
              </label>
              <input
                id="bt-size-fraction"
                type="number"
                min={1}
                max={100}
                value={positionSizeFractionInput}
                onChange={(e) => setPositionSizeFractionInput(e.target.value)}
                className={numberInputClass}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="bt-fixed-capital" className={labelClass}>
                {"₹"} per trade
              </label>
              <input
                id="bt-fixed-capital"
                type="number"
                min={1}
                value={fixedCapitalPerTradeInput}
                onChange={(e) => setFixedCapitalPerTradeInput(e.target.value)}
                className="w-28 rounded-md border bg-background px-2 py-1 text-xs hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40"
              />
            </div>
          )}
        </div>
      </details>

      {rangedRolling.length < lookbackDays ? (
        <p className="text-sm text-muted-foreground">
          Not enough overlapping AUM/share price history in the selected period ({rangedRolling.length} day
          {rangedRolling.length === 1 ? "" : "s"}) for a full {lookbackDays}-day lookback window.
        </p>
      ) : (
        resultsByThreshold.map(({ result, metrics }) => (
          <div key={result.threshold} className="space-y-3 rounded-lg border bg-card p-4">
            <p className="text-sm font-medium text-foreground">Z {"≤"} {result.threshold}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <Stat label="Trades" value={String(metrics.numTrades)} />
              <Stat label="Win rate" value={formatMetricPct(metrics.winRate, metrics.numTrades)} />
              <Stat
                label="Avg return"
                value={formatMetricPct(metrics.avgReturnPct, metrics.numTrades, true)}
                valueClassName={metrics.numTrades > 0 ? (metrics.avgReturnPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400") : undefined}
              />
              <Stat
                label="Median return"
                value={formatMetricPct(metrics.medianReturnPct, metrics.numTrades, true)}
                valueClassName={metrics.numTrades > 0 ? (metrics.medianReturnPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400") : undefined}
              />
              <Stat
                label="Total return"
                value={formatPct(metrics.totalCompoundedReturnPct, { alwaysSign: true })}
                valueClassName={metrics.totalCompoundedReturnPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}
              />
              <Stat label="Max drawdown" value={formatPct(metrics.maxDrawdownPct)} valueClassName="text-red-600 dark:text-red-400" />
              <Stat label="Profit factor" value={formatRatioMetric(metrics.profitFactor)} />
              <Stat label="Sharpe" value={formatRatioMetric(metrics.sharpeRatio)} />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={result.equityCurve} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tickFormatter={formatShortDateWithYear} tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => formatPriceInr(v)} width={85} />
                    <Tooltip
                      labelFormatter={(label) => (typeof label === "string" ? formatShortDateWithYear(label) : String(label ?? ""))}
                      formatter={(value) => (typeof value === "number" ? formatPriceInr(value) : String(value))}
                      contentStyle={tooltipContentStyle}
                    />
                    <Line
                      type="monotone"
                      dataKey="equity"
                      name={`${stockLabel ?? "Strategy"} Backtest Equity`}
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={binReturns(result.trades.map((t) => t.returnPct * 100))} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="bin" tick={{ fontSize: 10 }} label={{ value: "Return per trade (%)", position: "insideBottom", offset: -4, fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} width={30} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipContentStyle} />
                    <Bar dataKey="count" name="Trades" fill="var(--color-primary)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {result.trades.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entry Date</TableHead>
                      <TableHead className="text-right">Entry Price</TableHead>
                      <TableHead className="text-right">Entry Z</TableHead>
                      <TableHead>Exit Date</TableHead>
                      <TableHead className="text-right">Exit Price</TableHead>
                      <TableHead className="text-right">Exit Z</TableHead>
                      <TableHead>Exit Reason</TableHead>
                      <TableHead className="text-right">Holding Days</TableHead>
                      <TableHead className="text-right">Return %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.trades.map((t) => (
                      <TableRow key={`${t.entryDate}-${t.exitDate}`}>
                        <TableCell>{formatShortDateWithYear(t.entryDate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPriceInr(t.entryPrice)}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.entryZScore.toFixed(2)}</TableCell>
                        <TableCell>{formatShortDateWithYear(t.exitDate)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPriceInr(t.exitPrice)}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.exitZScore.toFixed(2)}</TableCell>
                        <TableCell className="capitalize">{t.exitReason.replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.holdingDays}</TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${t.returnPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                        >
                          {formatPct(t.returnPct, { alwaysSign: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No trades generated at this threshold over the available history.</p>
            )}
          </div>
        ))
      )}
    </div>
  );
}
