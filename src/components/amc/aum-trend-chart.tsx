"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCr, formatPct, formatPriceInr, formatReportPeriodLabel, formatShortDateWithYear } from "@/lib/utils/format";
import type { AumHistoryPoint, AmcStockPricePoint } from "@/lib/aum/history";
import {
  trimToLastContinuousRun,
  computeMovingAverage,
  computeCorrelationStats,
  firstDefinedIndex,
  toDatedValues,
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

// Recharts' own default tick placement always includes the exact domain
// boundary as a tick even when it doesn't fall on the same step as the
// others (e.g. 87k, 237k, 387k, then a boundary tick at 491k instead of the
// expected 537k) -- reads as "uneven"/inconsistent gridlines, especially on
// a chart with two independently-scaled axes where it's easy to misjudge
// which line a given height belongs to. This generates genuinely evenly
// spaced ticks at a "nice" round step (1/2/5 x 10^n) instead, so every gap
// between gridlines is identical; it does NOT change the plotted domain
// (padding/min/max), only which values get gridlines/labels.
function computeNiceTicks([lower, upper]: [number, number], count: number): number[] {
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower || count < 2) return [lower, upper];
  const rawStep = (upper - lower) / (count - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = niceNormalized * magnitude;
  const start = Math.ceil(lower / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= upper + step * 0.001; v += step) {
    ticks.push(Math.round(v));
  }
  return ticks.length >= 2 ? ticks : [lower, upper];
}

function computeYAxisDomain(data: AumHistoryPoint[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const point of data) {
    for (const value of [point.liveAumCr, point.reportedAumCr]) {
      if (typeof value === "number" && Number.isFinite(value)) {
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
  // is the identity transform), the smoothed value otherwise. undefined for
  // the leading days a moving average hasn't accumulated a full window for
  // yet -- Recharts leaves that contiguous prefix undrawn, same mechanism
  // that already makes stockPriceInr start late when it's missing.
  liveAumDisplay: number | undefined;
  stockPriceInr?: number;
}

// Builds the chart's per-date rows from the (already AUM-trimmed) data plus
// each series' own DISPLAY values (raw or moving-averaged, computed by the
// caller) -- a date with no stock price (a weekend/holiday the stock didn't
// trade, before/after the price history's own range, or before a moving
// average's first full window) simply has no point there, same as any
// normal stock chart. reportedAumCr passes through unchanged (spread from
// `point`) -- it's never smoothed, since it's a monthly step function, not
// a daily series.
function buildChartData(
  data: AumHistoryPoint[],
  liveAumDisplayValues: (number | undefined)[],
  stockPriceSeries: AmcStockPricePoint[] | undefined,
  stockPriceDisplayValues: (number | undefined)[] | undefined
): ChartPoint[] {
  const priceByDate = new Map<string, number>();
  if (stockPriceSeries && stockPriceDisplayValues) {
    stockPriceSeries.forEach((p, i) => {
      const value = stockPriceDisplayValues[i];
      if (value !== undefined) priceByDate.set(p.date, value);
    });
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

type RangeOption = "6m" | "1y" | "2y" | "3y" | "all";

const RANGE_OPTIONS: { value: RangeOption; label: string; months: number | null }[] = [
  { value: "6m", label: "6M", months: 6 },
  { value: "1y", label: "1Y", months: 12 },
  { value: "2y", label: "2Y", months: 24 },
  { value: "3y", label: "3Y", months: 36 },
  { value: "all", label: "All", months: null },
];

function subtractMonths(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
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
  const [showStockPrice, setShowStockPrice] = useState(true);
  const [maDaysInput, setMaDaysInput] = useState("");
  const [range, setRange] = useState<RangeOption>("3y");
  // Any blank/invalid/out-of-range entry clamps to 1 -- the identity
  // window, i.e. today's raw-daily default -- rather than crashing or
  // silently doing nothing.
  const maDays = Math.max(1, Math.min(250, parseInt(maDaysInput, 10) || 1));
  // Whether this AMC has share-price tracking AT ALL, independent of the
  // selected date range -- keeps the show/hide toggle button from
  // flickering in and out if a narrow range happens to have zero price
  // points (e.g. a just-listed AMC with "6M" selected).
  const hasStockPrice = !!stockPriceSeries && stockPriceSeries.length > 0;
  // Cutoff computed from the series' OWN latest date, not `new Date()`, so
  // this stays deterministic and doesn't depend on when the page happens
  // to be viewed relative to the data's own freshness.
  const rangeCutoffDate = useMemo(() => {
    const option = RANGE_OPTIONS.find((o) => o.value === range);
    if (!option || option.months === null || rawData.length === 0) return null;
    return subtractMonths(rawData[rawData.length - 1].date, option.months);
  }, [range, rawData]);
  const rangedRawData = useMemo(
    () => (rangeCutoffDate ? rawData.filter((d) => d.date >= rangeCutoffDate) : rawData),
    [rawData, rangeCutoffDate]
  );
  const rangedStockPriceSeries = useMemo(
    () => (stockPriceSeries && rangeCutoffDate ? stockPriceSeries.filter((p) => p.date >= rangeCutoffDate) : stockPriceSeries),
    [stockPriceSeries, rangeCutoffDate]
  );
  const data = useMemo(() => trimToLastContinuousRun(rangedRawData), [rangedRawData]);
  const liveAumDisplayValues = useMemo(
    () => computeMovingAverage(data.map((d) => d.liveAumCr), maDays),
    [data, maDays]
  );
  const stockPriceDisplayValues = useMemo(
    () =>
      rangedStockPriceSeries ? computeMovingAverage(rangedStockPriceSeries.map((p) => p.priceInr), maDays) : undefined,
    [rangedStockPriceSeries, maDays]
  );
  const chartData = useMemo(
    () => buildChartData(data, liveAumDisplayValues, rangedStockPriceSeries, stockPriceDisplayValues),
    [data, liveAumDisplayValues, rangedStockPriceSeries, stockPriceDisplayValues]
  );
  const yDomain = useMemo(() => computeYAxisDomain(data), [data]);
  const yTicks = useMemo(() => computeNiceTicks(yDomain, 5), [yDomain]);
  const tickDecimals = useMemo(() => computeTickDecimals(yDomain), [yDomain]);
  const changeSeries = useMemo(() => computeDailyChangeSeries(data), [data]);
  const pctYDomain = useMemo(() => computePctYAxisDomain(changeSeries), [changeSeries]);
  const stockYDomain = useMemo(
    () => (rangedStockPriceSeries ? computeStockPriceYAxisDomain(rangedStockPriceSeries) : ([0, 1] as [number, number])),
    [rangedStockPriceSeries]
  );
  const stockYTicks = useMemo(() => computeNiceTicks(stockYDomain, 5), [stockYDomain]);
  const rangeSelector = (
    <div className="flex items-center gap-1" role="group" aria-label="Date range">
      {RANGE_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => setRange(o.value)}
          className={
            o.value === range
              ? "rounded-md bg-foreground px-2 py-1 text-xs text-background"
              : "rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
  const maSuffix = maDays > 1 ? ` (${maDays}D avg)` : "";
  const liveAumSeriesName = `Live AUM${maSuffix}`;
  const stockSeriesName = `${stockLabel ? `${stockLabel} Share Price` : "Share Price"}${maSuffix}`;
  // Correlates day-over-day returns of whichever series is currently
  // displayed (raw or smoothed) -- only meaningful with a share price to
  // compare against. Cheap enough (~200 points) to always compute rather
  // than gating it behind showStockPrice too.
  const correlationStats = useMemo(() => {
    if (!rangedStockPriceSeries || !stockPriceDisplayValues) return null;
    const liveAumDisplayDated = toDatedValues(data.map((d) => d.date), liveAumDisplayValues);
    const stockPriceDisplayDated = toDatedValues(rangedStockPriceSeries.map((p) => p.date), stockPriceDisplayValues);
    return computeCorrelationStats(liveAumDisplayDated, stockPriceDisplayDated);
  }, [rangedStockPriceSeries, stockPriceDisplayValues, data, liveAumDisplayValues]);
  // Whenever the moving average trims off leading days, note where the
  // line actually starts instead of leaving the shorter line unexplained --
  // Live AUM and the share price can each start on a different date, since
  // they're independent series with their own history.
  const liveAumTruncatedFromDate = useMemo(() => {
    if (maDays <= 1) return null;
    const idx = firstDefinedIndex(liveAumDisplayValues);
    return idx > 0 ? data[idx].date : null;
  }, [maDays, liveAumDisplayValues, data]);
  const stockPriceTruncatedFromDate = useMemo(() => {
    if (maDays <= 1 || !rangedStockPriceSeries || !stockPriceDisplayValues) return null;
    const idx = firstDefinedIndex(stockPriceDisplayValues);
    return idx > 0 ? rangedStockPriceSeries[idx].date : null;
  }, [maDays, rangedStockPriceSeries, stockPriceDisplayValues]);

  if (rawData.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No history yet — a snapshot is captured once a day, check back tomorrow.
      </p>
    );
  }

  // Real history exists, but the selected range (e.g. "6M" on an AMC whose
  // real history ends further back than that) has none of it -- still show
  // the selector so the user can widen it back, rather than a dead end.
  if (data.length === 0) {
    return (
      <div className="space-y-2">
        <div className="flex justify-end">{rangeSelector}</div>
        <p className="text-sm text-muted-foreground">No data in the selected range.</p>
      </div>
    );
  }

  if (mode === "change") {
    return (
      <div className="space-y-2">
        <div className="flex justify-end">{rangeSelector}</div>
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={changeSeries} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tickFormatter={formatShortDateWithYear} tick={{ fontSize: 12 }} />
              <YAxis
                domain={pctYDomain}
                tick={{ fontSize: 12 }}
                tickFormatter={(v: number) => formatPct(v, { alwaysSign: true })}
                width={60}
              />
              <ReferenceLine y={0} className="stroke-border" />
              <Tooltip
                labelFormatter={(label) => (typeof label === "string" ? formatShortDateWithYear(label) : String(label ?? ""))}
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
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {liveAumTruncatedFromDate && <span>Showing Live AUM from {formatShortDateWithYear(liveAumTruncatedFromDate)} ({maDays}D avg)</span>}
          {hasStockPrice && showStockPrice && stockPriceTruncatedFromDate && (
            <span>
              Showing {stockLabel ?? "Share Price"} from {formatShortDateWithYear(stockPriceTruncatedFromDate)} ({maDays}D avg)
            </span>
          )}
          {hasStockPrice && showStockPrice && correlationStats && (
            <span className="font-mono">
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
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {rangeSelector}
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
            <XAxis dataKey="date" tickFormatter={formatShortDateWithYear} tick={{ fontSize: 12 }} />
            <YAxis
              domain={yDomain}
              ticks={yTicks}
              tick={{ fontSize: 12 }}
              tickFormatter={(v: number) => `${(v / 1000).toFixed(tickDecimals)}k`}
              width={50}
            />
            {showStockPrice && (
              <YAxis
                yAxisId="stock"
                orientation="right"
                domain={stockYDomain}
                ticks={stockYTicks}
                tick={{ fontSize: 12 }}
                tickFormatter={(v: number) => formatPriceInr(v)}
                width={70}
              />
            )}
            <Tooltip
              labelFormatter={(label) => (typeof label === "string" ? formatShortDateWithYear(label) : String(label ?? ""))}
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
