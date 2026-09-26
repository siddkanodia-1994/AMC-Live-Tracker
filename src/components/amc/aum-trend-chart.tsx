"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCr, formatPct, formatPriceInr, formatReportPeriodLabel, formatShortDateWithYear } from "@/lib/utils/format";
import type { AumHistoryPoint, AmcStockPricePoint } from "@/lib/aum/history";
import {
  trimToLastContinuousRun,
  computeMovingAverage,
  computeCorrelationStats,
  computeLevelCorrelationStats,
  priceToAumRatioStats,
  type DatedValue,
} from "@/lib/aum/series-math";
import { RANGE_OPTIONS, filterByRange, computeRangeCutoffDate, filterByCutoff, type RangeOption } from "@/lib/aum/date-range";

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
  // Round each tick to kill floating-point residue (e.g. 0.1 + 0.2), at a
  // precision derived from the step itself -- unconditionally rounding to
  // the nearest integer (as this used to) is fine for AUM/share-price
  // scales but collapses every tick on a price/AUM RATIO axis (~0.006) to
  // the same value (0), which then crashes Recharts on duplicate tick
  // keys. A large step (thousands of Cr) still rounds to whole numbers;
  // a tiny step keeps enough decimal places to stay distinct.
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 2);
  const roundTick = (v: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;
  const ticks: number[] = [];
  for (let v = start; v <= upper + step * 0.001; v += step) {
    ticks.push(roundTick(v));
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

// Ratio values (Share Price ÷ AUM) sit at a tiny, AMC-specific scale (price
// in the hundreds-to-thousands, AUM in lakh-crore) -- 6 decimals matches
// fair-value-explainer.tsx's own RATIO_DECIMALS convention for the same
// figure elsewhere in the app.
const RATIO_DECIMALS = 6;
function formatRatio(v: number): string {
  return v.toFixed(RATIO_DECIMALS);
}

// Same domain-padding approach as computeStockPriceYAxisDomain, but spans
// BOTH the ratio series' own min/max AND every reference line value -- a
// ±2SD line that's currently far from the plotted series must still never
// be clipped off the visible plot area.
function computeRatioYAxisDomain(ratioValues: number[], refLineValues: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of [...ratioValues, ...refLineValues]) {
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  const range = max - min;
  const padding = range > 0 ? range * DOMAIN_PADDING_RATIO : Math.max(Math.abs(max) * FLAT_DOMAIN_PADDING_RATIO, 0.000001);
  return [min - padding, max + padding];
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
  range: controlledRange,
  onRangeChange,
  maDaysInput: controlledMaDaysInput,
  onMaDaysInputChange,
  aumOnlyAveraging = false,
  levelsCorrelation = false,
}: {
  data: AumHistoryPoint[];
  mode?: "absolute" | "change";
  // Only set for the handful of AMCs whose own asset-management business
  // is itself a separately-listed stock -- undefined everywhere else, so
  // no toggle renders at all in that case.
  stockPriceSeries?: AmcStockPricePoint[];
  stockLabel?: string;
  // Controlled range/moving-avg, for the one caller (the Stock Correlation
  // table) that needs this chart's selection linked to its own controls.
  // Omit both of a pair to let the chart manage that piece of state
  // internally, as every other usage (each AMC's own detail page, the
  // homepage's industry-wide chart) does.
  range?: RangeOption;
  onRangeChange?: (range: RangeOption) => void;
  maDaysInput?: string;
  onMaDaysInputChange?: (value: string) => void;
  // Stock Correlation tab's own toggle, forwarded so Ratio view's ratio
  // (and its reference lines/Z-score) AND Absolute view's own Corr/R²
  // caption never disagree with that table. Only ever passed by that one
  // caller -- every other usage defaults to false, fully unaffected.
  // Absolute view's actual plotted price LINE is untouched by this
  // regardless -- only its Corr/R² caption and Ratio view's ratio
  // calculation read this.
  aumOnlyAveraging?: boolean;
  // Stock Correlation tab's own "Levels (no % chg)" toggle, forwarded so
  // Absolute view's own Corr/R² caption never disagrees with that table.
  // Only ever passed by that one caller -- every other usage defaults to
  // false. Ratio view is untouched -- this only reaches Absolute view's
  // correlationStats, below.
  levelsCorrelation?: boolean;
}) {
  const [showStockPrice, setShowStockPrice] = useState(true);
  // Which body/caption this chart currently renders -- "ratio" swaps the
  // dual-axis AUM/price view for a single (Share Price ÷ AUM) line with
  // Mean/±1SD/±2SD reference bands. Per-session only, deliberately not part
  // of the Stock Correlation tab's "Save as default" persistence (that
  // persists calculation INPUTS -- period/moving-avg/ratio-basis -- this is
  // just a view choice, same category as showStockPrice below).
  const [chartView, setChartView] = useState<"absolute" | "ratio">("absolute");
  // Independent from showStockPrice below -- Absolute view's own price
  // line default-shows and this is a separate opt-in overlay for Ratio
  // view, so switching views doesn't carry one's choice into the other.
  const [showPriceInRatioView, setShowPriceInRatioView] = useState(false);
  // null = "not yet touched, mirror the shared Moving avg (days) input" --
  // the moment the user types into the price-specific box it becomes a
  // real string and permanently stops following the shared input (even if
  // they later clear it back to the same value). This ONLY changes how the
  // overlaid price LINE is smoothed for display -- the ratio itself, its
  // reference lines, current ratio, and Z-score keep using the shared
  // maDays exactly as before, never this one.
  const [priceOverlayMaDaysInput, setPriceOverlayMaDaysInput] = useState<string | null>(null);
  const [internalMaDaysInput, setInternalMaDaysInput] = useState("");
  const [internalRange, setInternalRange] = useState<RangeOption>("3y");
  const maDaysInput = controlledMaDaysInput ?? internalMaDaysInput;
  const setMaDaysInput = onMaDaysInputChange ?? setInternalMaDaysInput;
  const range = controlledRange ?? internalRange;
  const setRange = onRangeChange ?? setInternalRange;
  // Any blank/invalid/out-of-range entry clamps to 1 -- the identity
  // window, i.e. today's raw-daily default -- rather than crashing or
  // silently doing nothing.
  const maDays = Math.max(1, Math.min(250, parseInt(maDaysInput, 10) || 1));
  // Effective value shown in the price-specific box -- mirrors maDaysInput
  // whenever the user hasn't typed into it directly yet.
  const effectivePriceOverlayMaDaysInput = priceOverlayMaDaysInput ?? maDaysInput;
  const priceOverlayMaDays = Math.max(1, Math.min(250, parseInt(effectivePriceOverlayMaDaysInput, 10) || 1));
  // Whether this AMC has share-price tracking AT ALL, independent of the
  // selected date range -- keeps the show/hide toggle button from
  // flickering in and out if a narrow range happens to have zero price
  // points (e.g. a just-listed AMC with "6M" selected).
  const hasStockPrice = !!stockPriceSeries && stockPriceSeries.length > 0;
  // Moving average computed over the FULL (unranged) history first, so a
  // day near the start of a narrow selected range still gets a real N-day
  // trailing average using data from just before the range boundary,
  // instead of an artificial warm-up gap right where the user's view
  // begins. The range filter is applied AFTER, to the already-smoothed
  // series -- exactly mirroring stock-correlation-table.tsx's computeRow,
  // so the table and this chart show identical numbers for the same
  // range/moving-avg selection when the two are linked.
  const data = useMemo(() => trimToLastContinuousRun(rawData), [rawData]);
  const liveAumDisplayValues = useMemo(
    () => computeMovingAverage(data.map((d) => d.liveAumCr), maDays),
    [data, maDays]
  );
  const stockPriceDisplayValues = useMemo(
    () => (stockPriceSeries ? computeMovingAverage(stockPriceSeries.map((p) => p.priceInr), maDays) : undefined),
    [stockPriceSeries, maDays]
  );
  // Separate smoothing pass for Ratio view's optional price overlay LINE
  // only -- everything that defines the ratio itself (below) keeps reading
  // stockPriceDisplayValues/maDays above, untouched.
  const priceOverlayDisplayValues = useMemo(
    () => (stockPriceSeries ? computeMovingAverage(stockPriceSeries.map((p) => p.priceInr), priceOverlayMaDays) : undefined),
    [stockPriceSeries, priceOverlayMaDays]
  );
  const priceOverlayByDate = useMemo(() => {
    const map = new Map<string, number>();
    if (stockPriceSeries && priceOverlayDisplayValues) {
      stockPriceSeries.forEach((p, i) => {
        const value = priceOverlayDisplayValues[i];
        if (value !== undefined) map.set(p.date, value);
      });
    }
    return map;
  }, [stockPriceSeries, priceOverlayDisplayValues]);
  // AUM-only-avg-aware price series -- raw (unsmoothed) once aumOnlyAveraging
  // is on, otherwise the same shared-maDays smoothed values Absolute view's
  // own price LINE uses. Feeds Ratio view's ratio calc AND Absolute view's
  // own Corr/R² caption below (so both always match the table's Corr/R² for
  // the same toggle state) -- kept entirely separate from
  // stockPriceDisplayValues/chartData.stockPriceInr so the actual plotted
  // price LINE in Absolute view never changes regardless of this toggle.
  const ratioPriceDisplayValues = useMemo(
    () => (stockPriceSeries ? (aumOnlyAveraging ? stockPriceSeries.map((p) => p.priceInr) : stockPriceDisplayValues) : undefined),
    [stockPriceSeries, aumOnlyAveraging, stockPriceDisplayValues]
  );
  const ratioPriceByDate = useMemo(() => {
    const map = new Map<string, number>();
    if (stockPriceSeries && ratioPriceDisplayValues) {
      stockPriceSeries.forEach((p, i) => {
        const value = ratioPriceDisplayValues[i];
        if (value !== undefined) map.set(p.date, value);
      });
    }
    return map;
  }, [stockPriceSeries, ratioPriceDisplayValues]);
  const fullChartData = useMemo(
    () => buildChartData(data, liveAumDisplayValues, stockPriceSeries, stockPriceDisplayValues),
    [data, liveAumDisplayValues, stockPriceSeries, stockPriceDisplayValues]
  );
  const chartData = useMemo(() => filterByRange(fullChartData, range), [fullChartData, range]);
  const yDomain = useMemo(() => computeYAxisDomain(chartData), [chartData]);
  const yTicks = useMemo(() => computeNiceTicks(yDomain, 5), [yDomain]);
  const tickDecimals = useMemo(() => computeTickDecimals(yDomain), [yDomain]);
  const changeSeries = useMemo(() => computeDailyChangeSeries(chartData), [chartData]);
  const pctYDomain = useMemo(() => computePctYAxisDomain(changeSeries), [changeSeries]);
  const rangedStockPricePoints = useMemo(
    () =>
      chartData
        .filter((p) => p.stockPriceInr !== undefined)
        .map((p) => ({ date: p.date, priceInr: p.stockPriceInr as number })),
    [chartData]
  );
  const stockYDomain = useMemo(
    () => (hasStockPrice ? computeStockPriceYAxisDomain(rangedStockPricePoints) : ([0, 1] as [number, number])),
    [hasStockPrice, rangedStockPricePoints]
  );
  const stockYTicks = useMemo(() => computeNiceTicks(stockYDomain, 5), [stockYDomain]);
  // Same aligned-pair filtering style as rangedStockPricePoints above, but
  // keeping BOTH series (not just price) since the ratio needs both --
  // built once and shared by ratioStats/ratioSeries below so they can never
  // disagree about which days are included.
  const alignedRatioInputs = useMemo(() => {
    if (!hasStockPrice) return { dates: [] as string[], aum: [] as number[], price: [] as number[] };
    const dates: string[] = [];
    const aum: number[] = [];
    const price: number[] = [];
    for (const p of chartData) {
      const ratioPrice = ratioPriceByDate.get(p.date);
      if (p.liveAumDisplay !== undefined && ratioPrice !== undefined) {
        dates.push(p.date);
        aum.push(p.liveAumDisplay);
        price.push(ratioPrice);
      }
    }
    return { dates, aum, price };
  }, [chartData, hasStockPrice, ratioPriceByDate]);
  // Reuses the exact same function the Stock Correlation table's Z-score
  // column calls -- so this chart's reference lines are guaranteed
  // consistent with that table's own Z-score for the same AMC/period/
  // moving-avg selection, never a second slightly-different implementation.
  const ratioStats = useMemo(
    () => priceToAumRatioStats(alignedRatioInputs.aum, alignedRatioInputs.price),
    [alignedRatioInputs]
  );
  const ratioSeries = useMemo(() => {
    const { dates, aum, price } = alignedRatioInputs;
    const points: { date: string; ratio: number }[] = [];
    for (let i = 0; i < dates.length; i++) {
      if (aum[i] !== 0) points.push({ date: dates[i], ratio: price[i] / aum[i] });
    }
    return points;
  }, [alignedRatioInputs]);
  // The ratio chart's actual `data` source (distinct from ratioSeries
  // above, which only feeds the reference-line/caption stats) -- carries
  // `ratio` (still off the SHARED-maDays stockPriceInr, per design: the
  // overlay's own smoothing never changes what the ratio means) AND
  // `stockPriceOverlayInr` (off priceOverlayByDate, its own independent
  // smoothing) -- the optional overlay Line reads that second field, never
  // stockPriceInr, so the two stay fully decoupled.
  const ratioChartData = useMemo(
    () =>
      chartData.map((p) => {
        const ratioPrice = ratioPriceByDate.get(p.date);
        return {
          ...p,
          ratio:
            p.liveAumDisplay !== undefined && ratioPrice !== undefined && p.liveAumDisplay !== 0
              ? ratioPrice / p.liveAumDisplay
              : undefined,
          stockPriceOverlayInr: priceOverlayByDate.get(p.date),
        };
      }),
    [chartData, priceOverlayByDate, ratioPriceByDate]
  );
  // Overlay price line's own Y-axis domain/ticks -- kept separate from
  // stockYDomain/stockYTicks (which stay driven by the shared-maDays price
  // series for Absolute view) since the overlay can be smoothed over a
  // different window and would otherwise be framed by the wrong range.
  const rangedPriceOverlayPoints = useMemo(
    () =>
      ratioChartData
        .filter((p) => p.stockPriceOverlayInr !== undefined)
        .map((p) => ({ date: p.date, priceInr: p.stockPriceOverlayInr as number })),
    [ratioChartData]
  );
  const priceOverlayYDomain = useMemo(
    () => (hasStockPrice ? computeStockPriceYAxisDomain(rangedPriceOverlayPoints) : ([0, 1] as [number, number])),
    [hasStockPrice, rangedPriceOverlayPoints]
  );
  const priceOverlayYTicks = useMemo(() => computeNiceTicks(priceOverlayYDomain, 5), [priceOverlayYDomain]);
  // Mirrors stockPriceTruncatedFromDate's role but for the overlay's own
  // (possibly different) smoothing window.
  const priceOverlayTruncatedFromDate = useMemo(() => {
    if (priceOverlayMaDays <= 1 || !hasStockPrice) return null;
    const idx = ratioChartData.findIndex((p) => p.stockPriceOverlayInr !== undefined);
    return idx > 0 ? ratioChartData[idx].date : null;
  }, [priceOverlayMaDays, hasStockPrice, ratioChartData]);
  const priceOverlaySeriesName = `${stockLabel ? `${stockLabel} Share Price` : "Share Price"}${priceOverlayMaDays > 1 ? ` (${priceOverlayMaDays}D avg)` : ""}`;
  const currentRatio = ratioSeries.length > 0 ? ratioSeries[ratioSeries.length - 1].ratio : null;
  const ratioZScore =
    ratioStats && currentRatio !== null && ratioStats.stdDev !== 0 ? (currentRatio - ratioStats.meanRatio) / ratioStats.stdDev : null;
  const ratioRefLines = useMemo(
    () =>
      ratioStats
        ? {
            mean: ratioStats.meanRatio,
            plus1: ratioStats.meanRatio + ratioStats.stdDev,
            plus2: ratioStats.meanRatio + 2 * ratioStats.stdDev,
            minus1: ratioStats.meanRatio - ratioStats.stdDev,
            minus2: ratioStats.meanRatio - 2 * ratioStats.stdDev,
          }
        : null,
    [ratioStats]
  );
  const ratioYDomain = useMemo(
    () =>
      computeRatioYAxisDomain(
        ratioSeries.map((p) => p.ratio),
        ratioRefLines ? Object.values(ratioRefLines) : []
      ),
    [ratioSeries, ratioRefLines]
  );
  const ratioYTicks = useMemo(() => computeNiceTicks(ratioYDomain, 5), [ratioYDomain]);
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
  // Only rendered when hasStockPrice -- a ratio needs both series, so this
  // toggle has nothing to do on the AUM-only charts (amc-grid.tsx's mini
  // cards never pass stockPriceSeries at all).
  const chartViewToggle = hasStockPrice ? (
    <div className="flex items-center gap-1" role="group" aria-label="Chart view">
      {(["absolute", "ratio"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => setChartView(v)}
          className={
            v === chartView
              ? "rounded-md bg-foreground px-2 py-1 text-xs text-background"
              : "rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          }
        >
          {v === "absolute" ? "Absolute" : "Ratio"}
        </button>
      ))}
    </div>
  ) : null;
  const maSuffix = maDays > 1 ? ` (${maDays}D avg)` : "";
  const liveAumSeriesName = `Live AUM${maSuffix}`;
  const stockSeriesName = `${stockLabel ? `${stockLabel} Share Price` : "Share Price"}${maSuffix}`;
  // Correlates day-over-day returns (or, with levelsCorrelation on, the raw
  // levels directly) of whichever series the table's own toggles currently
  // select -- only meaningful with a share price to compare against. Cheap
  // enough (~200 points) to always compute rather than gating it behind
  // showStockPrice too. Uses ratioPriceDisplayValues (not
  // stockPriceDisplayValues) for the price leg so this always matches the
  // table's own Corr/R² for the same AUM-only-avg state, same as Ratio
  // view's ratio calc already does -- the actual plotted price LINE in
  // Absolute view is unaffected either way, since that reads chartData/
  // stockPriceDisplayValues directly, not this.
  //
  // Each series' own full date list is used independently here (mirrors
  // stock-correlation-table.tsx's computeRow exactly), NOT chartData
  // (which is keyed to AUM's own dates only, via buildChartData's
  // per-AUM-date price lookup) -- a date where price has a row but AUM
  // doesn't (e.g. a stray non-trading-day price entry) would otherwise
  // never get a row in chartData at all, silently dropping that day's
  // return before it's even computed, rather than correctly computing it
  // and only excluding it at the final correlation-intersection step.
  const correlationStats = useMemo(() => {
    if (!hasStockPrice) return null;
    const cutoffDate = computeRangeCutoffDate(data, range);
    const aumFullDated = data
      .map((d, i) => ({ date: d.date, value: liveAumDisplayValues[i] }))
      .filter((d): d is DatedValue => d.value !== undefined);
    const priceFullDated = (stockPriceSeries ?? [])
      .map((p, i) => ({ date: p.date, value: ratioPriceDisplayValues?.[i] }))
      .filter((d): d is DatedValue => d.value !== undefined);
    const liveAumDisplayDated = filterByCutoff(aumFullDated, cutoffDate);
    const stockPriceDisplayDated = filterByCutoff(priceFullDated, cutoffDate);
    return levelsCorrelation
      ? computeLevelCorrelationStats(liveAumDisplayDated, stockPriceDisplayDated)
      : computeCorrelationStats(liveAumDisplayDated, stockPriceDisplayDated);
  }, [data, liveAumDisplayValues, stockPriceSeries, ratioPriceDisplayValues, range, hasStockPrice, levelsCorrelation]);
  // Whenever the moving average's warm-up gap extends INTO the currently
  // selected range's visible window, note where the line actually starts
  // instead of leaving the shorter line unexplained -- Live AUM and the
  // share price can each start on a different date, since they're
  // independent series with their own history. A gap that falls entirely
  // before the range's own start (already warmed up by the time the
  // visible window begins) correctly shows nothing here.
  const liveAumTruncatedFromDate = useMemo(() => {
    if (maDays <= 1) return null;
    const idx = chartData.findIndex((p) => p.liveAumDisplay !== undefined);
    return idx > 0 ? chartData[idx].date : null;
  }, [maDays, chartData]);
  const stockPriceTruncatedFromDate = useMemo(() => {
    if (maDays <= 1 || !hasStockPrice) return null;
    const idx = chartData.findIndex((p) => p.stockPriceInr !== undefined);
    return idx > 0 ? chartData[idx].date : null;
  }, [maDays, hasStockPrice, chartData]);

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
  if (chartData.length === 0) {
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
          {chartView === "ratio"
            ? ratioStats &&
              currentRatio !== null &&
              ratioZScore !== null && (
                <>
                  <span className="font-mono">
                    Mean ratio {formatRatio(ratioStats.meanRatio)} · Current {formatRatio(currentRatio)} ·{" "}
                    <span className={ratioZScore >= 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                      Z-score {ratioZScore >= 0 ? "+" : ""}
                      {ratioZScore.toFixed(2)}σ
                    </span>{" "}
                    · {ratioStats.n} trading days
                    {maDays > 1 ? `, ${maDays}D avg${aumOnlyAveraging ? " AUM (raw price)" : ""}` : ""}
                  </span>
                  {showPriceInRatioView && priceOverlayTruncatedFromDate && (
                    <span>
                      Showing {stockLabel ?? "Share Price"} from {formatShortDateWithYear(priceOverlayTruncatedFromDate)} (
                      {priceOverlayMaDays}D avg)
                    </span>
                  )}
                </>
              )
            : (
                <>
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
                </>
              )}
        </div>
        <div className="flex items-center gap-2">
          {rangeSelector}
          {chartViewToggle}
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
          {hasStockPrice && chartView === "absolute" && (
            <button
              type="button"
              onClick={() => setShowStockPrice((v) => !v)}
              className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showStockPrice ? `Hide ${stockLabel} share price` : `+ Show ${stockLabel} share price`}
            </button>
          )}
          {hasStockPrice && chartView === "ratio" && (
            <button
              type="button"
              onClick={() => setShowPriceInRatioView((v) => !v)}
              className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showPriceInRatioView ? `Hide ${stockLabel} share price` : `+ Show ${stockLabel} share price`}
            </button>
          )}
          {hasStockPrice && chartView === "ratio" && showPriceInRatioView && (
            <>
              <label htmlFor="price-overlay-ma-days" className="text-xs text-muted-foreground">
                Price avg (days)
              </label>
              <input
                id="price-overlay-ma-days"
                type="number"
                min={1}
                max={250}
                value={effectivePriceOverlayMaDaysInput}
                onChange={(e) => setPriceOverlayMaDaysInput(e.target.value)}
                placeholder="Off"
                className="w-16 rounded-md border bg-background px-2 py-1 text-xs hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40"
              />
            </>
          )}
        </div>
      </div>
      <div className="h-80 w-full">
        {chartView === "ratio" && !ratioStats ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Not enough overlapping AUM/share price history in the selected range to compute the ratio.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {chartView === "ratio" && ratioStats && ratioRefLines ? (
              <LineChart data={ratioChartData} margin={{ top: 8, right: 40, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tickFormatter={formatShortDateWithYear} tick={{ fontSize: 12 }} />
                <YAxis domain={ratioYDomain} ticks={ratioYTicks} tick={{ fontSize: 12 }} tickFormatter={formatRatio} width={80} />
                {showPriceInRatioView && (
                  <YAxis
                    yAxisId="stock"
                    orientation="right"
                    domain={priceOverlayYDomain}
                    ticks={priceOverlayYTicks}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v: number) => formatPriceInr(v)}
                    width={70}
                  />
                )}
                <Tooltip
                  labelFormatter={(label) => (typeof label === "string" ? formatShortDateWithYear(label) : String(label ?? ""))}
                  formatter={(value, name) => {
                    if (name === priceOverlaySeriesName) {
                      return typeof value === "number" ? formatPriceInr(value) : String(value);
                    }
                    return typeof value === "number" ? formatRatio(value) : String(value);
                  }}
                  contentStyle={{
                    backgroundColor: "var(--color-popover)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-popover-foreground)",
                    fontSize: 12,
                  }}
                />
                {showPriceInRatioView && <Legend wrapperStyle={{ fontSize: 12 }} />}
                {/* Labels sit just OUTSIDE the plot ("right") when there's no
                    second axis to collide with, but that same offset lands
                    on top of the price axis's own tick labels once one is
                    added -- "insideBottomLeft" moves them to the ratio
                    axis's own side instead, inside the plot, clear of the
                    price axis entirely. */}
                <ReferenceLine
                  y={ratioRefLines.mean}
                  stroke="var(--color-muted-foreground)"
                  label={{
                    value: "Mean",
                    position: showPriceInRatioView ? "insideBottomLeft" : "right",
                    fontSize: 10,
                    fill: "var(--color-muted-foreground)",
                  }}
                />
                <ReferenceLine
                  y={ratioRefLines.plus1}
                  stroke="var(--color-red-400)"
                  strokeDasharray="4 4"
                  label={{
                    value: "+1 SD",
                    position: showPriceInRatioView ? "insideBottomLeft" : "right",
                    fontSize: 10,
                    fill: "var(--color-red-400)",
                  }}
                />
                <ReferenceLine
                  y={ratioRefLines.plus2}
                  stroke="var(--color-red-600)"
                  strokeDasharray="4 4"
                  label={{
                    value: "+2 SD",
                    position: showPriceInRatioView ? "insideBottomLeft" : "right",
                    fontSize: 10,
                    fill: "var(--color-red-600)",
                  }}
                />
                <ReferenceLine
                  y={ratioRefLines.minus1}
                  stroke="var(--color-emerald-400)"
                  strokeDasharray="4 4"
                  label={{
                    value: "-1 SD",
                    position: showPriceInRatioView ? "insideBottomLeft" : "right",
                    fontSize: 10,
                    fill: "var(--color-emerald-400)",
                  }}
                />
                <ReferenceLine
                  y={ratioRefLines.minus2}
                  stroke="var(--color-emerald-600)"
                  strokeDasharray="4 4"
                  label={{
                    value: "-2 SD",
                    position: showPriceInRatioView ? "insideBottomLeft" : "right",
                    fontSize: 10,
                    fill: "var(--color-emerald-600)",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="ratio"
                  name={`${stockLabel ?? "Share Price"} ÷ Live AUM`}
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
                {showPriceInRatioView && (
                  <Line
                    yAxisId="stock"
                    type="monotone"
                    dataKey="stockPriceOverlayInr"
                    name={priceOverlaySeriesName}
                    stroke="var(--color-violet-500)"
                    strokeWidth={1.5}
                    dot={{ r: 2 }}
                  />
                )}
              </LineChart>
            ) : (
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
            )}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
