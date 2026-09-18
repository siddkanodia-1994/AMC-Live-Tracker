"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCr, formatPct, formatPriceInr, formatReportPeriodLabel, formatShortDate } from "@/lib/utils/format";
import type { AumHistoryPoint, AmcStockPricePoint } from "@/lib/aum/history";
import {
  trimToLastContinuousRun,
  computeMovingAverage,
  computeCorrelationStats,
  type DatedValue,
} from "@/lib/aum/series-math";

// Padding added above/below the combined (live + reported) data range, as a
// fraction of that range, so the line doesn't sit flush against the plot
// border. Applied whether this chart is showing the industry-wide total (a
// wide absolute range) or a single AMC (a narrower one).
const DOMAIN_PADDING_RATIO = 0.1;

// Fallback padding when the data has zero variance (a single snapshot, a
// brand-new AMC, or a genuinely flat stretch) -- min === max would otherwise
// collapse the domain to a single point. Expressed as a fraction of the
// value itself so it scales with the AMC's AUM level, with an absolute floor
// for the all-zero case.
const FLAT_DOMAIN_PADDING_RATIO = 0.05;
const MIN_ABSOLUTE_PADDING_CR = 1;

// Zooming the axis into the real data range (instead of always starting at
// 0) means ticks are no longer guaranteed to land on round thousands, so a
// fixed "0 decimals" formatter can round several distinct ticks down to the
// same label. Scale decimal places to how many thousands of Cr the padded
// domain actually spans.
function computeTickDecimals([lower, upper]: [number, number]): number {
  const spanInThousands = (upper - lower) / 1000;
  if (spanInThousands >= 10) return 0;
  if (spanInThousands >= 1) return 1;
  return 2;
}

function computeYAxisDomain(data: AumHistoryPoint[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const point of data) {
    for (const value of [point.liveAumCr, point.reportedAumCr]) {
      if (Number.isFinite(value)) {
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1];
  }

  const range = max - min;
  const padding =
    range > 0
      ? range * DOMAIN_PADDING_RATIO
      : Math.max(Math.abs(max) * FLAT_DOMAIN_PADDING_RATIO, MIN_ABSOLUTE_PADDING_CR);

  return [Math.max(0, min - padding), max + padding];
}

interface ChartPoint extends AumHistoryPoint {
  // Whatever's currently displayed for Live AUM -- identical to liveAumCr
  // when no moving average is applied (computeMovingAverage's windowDays=1
  // is the identity transform), the smoothed value otherwise.
  liveAumDisplay: number;
  stockPriceInr?: number;
}

// Builds the chart's per-date rows from the (already AUM-trimmed) data plus
// each series' own DISPLAY values (raw or moving-averaged, computed by the
// caller) -- a date with no stock price (a weekend/holiday the stock didn't
// trade, or before/after the price history's own range) simply has no
// point there, same as any normal stock chart. reportedAumCr passes
// through unchanged (spread from `point`) -- it's never smoothed, since
// it's a monthly step function, not a daily series.
function buildChartData(
  data: AumHistoryPoint[],
  liveAumDisplayValues: number[],
  stockPriceSeries: AmcStockPricePoint[] | undefined,
  stockPriceDisplayValues: number[] | undefined
): ChartPoint[] {
  const priceByDate = new Map<string, number>();
  if (stockPriceSeries && stockPriceDisplayValues) {
    stockPriceSeries.forEach((p, i) => priceByDate.set(p.date, stockPriceDisplayValues[i]));
  }
  return data.map((point, i) => ({
    ...point,
    liveAumDisplay: liveAumDisplayValues[i],
    stockPriceInr: priceByDate.get(point.date),
  }));
}

// Same shape as computeYAxisDomain, just over the one stock-price series --
// kept separate since it needs its own independent right-side axis/domain,
// entirely unrelated to the AUM (₹ crore) scale on the left.
function computeStockPriceYAxisDomain(series: AmcStockPricePoint[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of series) {
    if (Number.isFinite(p.priceInr)) {
      if (p.priceInr < min) min = p.priceInr;
      if (p.priceInr > max) max = p.priceInr;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  const range = max - min;
  const padding =
    range > 0
      ? range * DOMAIN_PADDING_RATIO
      : Math.max(Math.abs(max) * FLAT_DOMAIN_PADDING_RATIO, MIN_ABSOLUTE_PADDING_CR);
  return [Math.max(0, min - padding), max + padding];
}

interface DailyChangePoint {
  date: string;
  changePct: number | null;
}

// Day-over-day % change in Live AUM, one point per day starting from the
// SECOND date in the history -- the first day has no prior day to diff
// against, so it's simply not included (not shown as a fabricated 0%).
function computeDailyChangeSeries(data: AumHistoryPoint[]): DailyChangePoint[] {
  const points: DailyChangePoint[] = [];
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1].liveAumCr;
    const curr = data[i].liveAumCr;
    points.push({ date: data[i].date, changePct: prev !== 0 ? (curr - prev) / prev : null });
  }
  return points;
}

// Colors each day's dot by that day's own sign -- green for an up day, red
// for a down day, muted for the (rare) day with no computable change --
// same emerald/red convention used everywhere else in this app (PctCell,
// AumDeltaBadge), just applied per-point instead of as one flat line color.
function ChangeDot(props: { cx?: number; cy?: number; payload?: DailyChangePoint }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  const color =
    payload.changePct === null
      ? "var(--color-muted-foreground)"
      : payload.changePct >= 0
        ? "var(--color-emerald-500)"
        : "var(--color-red-500)";
  return <circle cx={cx} cy={cy} r={3} fill={color} stroke={color} />;
}

function computePctYAxisDomain(points: DailyChangePoint[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.changePct !== null) {
      if (p.changePct < min) min = p.changePct;
      if (p.changePct > max) max = p.changePct;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [-0.01, 0.01];
  const range = max - min;
  const padding = range > 0 ? range * DOMAIN_PADDING_RATIO : Math.max(Math.abs(max) * FLAT_DOMAIN_PADDING_RATIO, 0.001);
  return [min - padding, max + padding];
}

export function AumTrendChart({
  data: rawData,
  mode = "absolute",
  stockPriceSeries,
  stockLabel,
}: {
  data: AumHistoryPoint[];
  mode?: "absolute" | "change";
  // Only set for the handful of AMCs whose own asset-management business
  // is itself a separately-listed stock -- undefined everywhere else, so
  // no toggle renders at all in that case.
  stockPriceSeries?: AmcStockPricePoint[];
  stockLabel?: string;
}) {
  const [showStockPrice, setShowStockPrice] = useState(false);
  const [maDaysInput, setMaDaysInput] = useState("");
  // Any blank/invalid/out-of-range entry clamps to 1 -- the identity
  // window, i.e. today's raw-daily default -- rather than crashing or
  // silently doing nothing.
  const maDays = Math.max(1, Math.min(250, parseInt(maDaysInput, 10) || 1));
  const data = useMemo(() => trimToLastContinuousRun(rawData), [rawData]);
  const liveAumDisplayValues = useMemo(
    () => computeMovingAverage(data.map((d) => d.liveAumCr), maDays),
    [data, maDays]
  );
  const stockPriceDisplayValues = useMemo(
    () => (stockPriceSeries ? computeMovingAverage(stockPriceSeries.map((p) => p.priceInr), maDays) : undefined),
    [stockPriceSeries, maDays]
  );
  const chartData = useMemo(
    () => buildChartData(data, liveAumDisplayValues, stockPriceSeries, stockPriceDisplayValues),
    [data, liveAumDisplayValues, stockPriceSeries, stockPriceDisplayValues]
  );
  const yDomain = useMemo(() => computeYAxisDomain(data), [data]);
  const tickDecimals = useMemo(() => computeTickDecimals(yDomain), [yDomain]);
  const changeSeries = useMemo(() => computeDailyChangeSeries(data), [data]);
  const pctYDomain = useMemo(() => computePctYAxisDomain(changeSeries), [changeSeries]);
  const hasStockPrice = !!stockPriceSeries && stockPriceSeries.length > 0;
  const stockYDomain = useMemo(
    () => (stockPriceSeries ? computeStockPriceYAxisDomain(stockPriceSeries) : ([0, 1] as [number, number])),
    [stockPriceSeries]
  );
  const maSuffix = maDays > 1 ? ` (${maDays}D avg)` : "";
  const liveAumSeriesName = `Live AUM${maSuffix}`;
  const stockSeriesName = `${stockLabel ? `${stockLabel} Share Price` : "Share Price"}${maSuffix}`;
  // Correlates day-over-day returns of whichever series is currently
  // displayed (raw or smoothed) -- only meaningful with a share price to
  // compare against. Cheap enough (~200 points) to always compute rather
  // than gating it behind showStockPrice too.
  const correlationStats = useMemo(() => {
    if (!stockPriceSeries || !stockPriceDisplayValues) return null;
    const liveAumDisplayDated: DatedValue[] = data.map((d, i) => ({ date: d.date, value: liveAumDisplayValues[i] }));
    const stockPriceDisplayDated: DatedValue[] = stockPriceSeries.map((p, i) => ({
      date: p.date,
      value: stockPriceDisplayValues[i],
    }));
    return computeCorrelationStats(liveAumDisplayDated, stockPriceDisplayDated);
  }, [stockPriceSeries, stockPriceDisplayValues, data, liveAumDisplayValues]);

  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No history yet — a snapshot is captured once a day, check back tomorrow.
      </p>
    );
  }

  if (mode === "change") {
    return (
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={changeSeries} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 12 }} />
            <YAxis
              domain={pctYDomain}
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => formatPct(v, { alwaysSign: true })}
              width={60}
            />
            <ReferenceLine y={0} className="stroke-border" />
            <Tooltip
              labelFormatter={(label) => (typeof label === "string" ? formatShortDate(label) : String(label ?? ""))}
              formatter={(value) => (typeof value === "number" ? formatPct(value, { alwaysSign: true }) : String(value))}
              contentStyle={{
                backgroundColor: "var(--color-popover)",
                borderColor: "var(--color-border)",
                color: "var(--color-popover-foreground)",
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="changePct"
              name="Live AUM % Change"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={<ChangeDot />}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {hasStockPrice && showStockPrice && correlationStats && (
            <>
              Corr{" "}
              <span
                className={
                  correlationStats.r >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                }
              >
                {formatPct(correlationStats.r, { alwaysSign: true })}
              </span>{" "}
              · R² {formatPct(correlationStats.r2)} · {correlationStats.n} trading days
              {maDays > 1 ? `, ${maDays}D avg` : ""}
            </>
          )}
        </span>
        <div className="flex items-center gap-2">
          <label htmlFor="ma-days" className="text-xs text-muted-foreground">
            Moving avg (days)
          </label>
          <input
            id="ma-days"
            type="number"
            min={1}
            max={250}
            value={maDaysInput}
            onChange={(e) => setMaDaysInput(e.target.value)}
            placeholder="Off"
            className="w-16 rounded-md border bg-background px-2 py-1 text-xs hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40"
          />
          {hasStockPrice && (
            <button
              type="button"
              onClick={() => setShowStockPrice((v) => !v)}
              className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showStockPrice ? `Hide ${stockLabel} share price` : `+ Show ${stockLabel} share price`}
            </button>
          )}
        </div>
      </div>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 12 }} />
            <YAxis
              domain={yDomain}
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => `${(v / 1000).toFixed(tickDecimals)}k`}
              width={50}
            />
            {showStockPrice && (
              <YAxis
                yAxisId="stock"
                orientation="right"
                domain={stockYDomain}
                tick={{ fontSize: 12 }}
                tickFormatter={(v: number) => formatPriceInr(v)}
                width={70}
              />
            )}
            <Tooltip
              labelFormatter={(label) => (typeof label === "string" ? formatShortDate(label) : String(label ?? ""))}
              formatter={(value, name, item) => {
                if (name === stockSeriesName) {
                  return typeof value === "number" ? formatPriceInr(value) : String(value);
                }
                const formatted = typeof value === "number" ? formatCr(value) : String(value);
                // Reported AUM only steps once a month (when a new workbook is
                // imported) -- show which report period it reflects alongside
                // the value, since the chart's X axis is daily.
                const reportPeriod = (item?.payload as AumHistoryPoint | undefined)?.reportPeriod;
                if (name === "Reported AUM" && reportPeriod) {
                  return `${formatted} (${formatReportPeriodLabel(reportPeriod)})`;
                }
                return formatted;
              }}
              contentStyle={{
                backgroundColor: "var(--color-popover)",
                borderColor: "var(--color-border)",
                color: "var(--color-popover-foreground)",
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line
              type="monotone"
              dataKey="liveAumDisplay"
              name={liveAumSeriesName}
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="reportedAumCr"
              name="Reported AUM"
              stroke="var(--color-muted-foreground)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={{ r: 2 }}
            />
            {showStockPrice && (
              <Line
                yAxisId="stock"
                type="monotone"
                dataKey="stockPriceInr"
                name={stockSeriesName}
                stroke="var(--color-violet-500)"
                strokeWidth={1.5}
                dot={{ r: 2 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
