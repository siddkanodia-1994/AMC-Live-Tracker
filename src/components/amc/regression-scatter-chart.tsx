"use client";

import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { formatCr, formatPriceInr, formatShortDateWithYear } from "@/lib/utils/format";
import type { RegressionChartPoint } from "@/lib/amc-stock/regression-engine";

// Driver -> price scatter for the Stock Correlation tab's regression
// section, modeled on the MCX dashboard's "Revenue MA45 -> Price" chart the
// user shared: one dot per session at (lagged AUM MA, share price), shaded
// from light (oldest) to navy (most recent), the latest session ringed, and
// the regression's own fitted line dashed through it. x is exactly the
// regression's driver and the line is exactly its slope/intercept, so this
// chart, the Actual-vs-Model chart above it and the stat tiles all agree.

// Same blue as the Actual-vs-Model chart's model line (regression-chart.tsx),
// so "the fit" reads as one thing across both charts.
const FIT_LINE = "#3B63C9";
// Older -> recent shading endpoints, matched to the reference chart.
const OLDEST_RGB: [number, number, number] = [203, 213, 240];
const NEWEST_RGB: [number, number, number] = [30, 58, 138];
const LATEST_RING = "#111827";

/** Colour for a session at position t in [0, 1] of the fitted window (0 = oldest, 1 = newest). */
export function dateShade(t: number): string {
  const c = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const [r, g, b] = OLDEST_RGB.map((o, i) => Math.round(o + (NEWEST_RGB[i] - o) * c));
  return `rgb(${r}, ${g}, ${b})`;
}

interface ScatterRow {
  date: string;
  driver: number;
  close: number;
  model: number;
  fill: string;
}

function ScatterTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: ScatterRow }> }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const gapPct = row.model !== 0 ? ((row.close - row.model) / row.model) * 100 : null;
  // Same fixed-dark card as the Actual-vs-Model chart's tooltip.
  return (
    <div className="rounded-lg px-3 py-2.5 text-xs" style={{ backgroundColor: "#1b2130", color: "#eef1f6" }}>
      <div className="mb-1.5 font-semibold">{formatShortDateWithYear(row.date)}</div>
      <div>AUM MA: {formatCr(row.driver)}</div>
      <div>Close: {formatPriceInr(row.close)}</div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: FIT_LINE }} />
        Fit: {formatPriceInr(row.model)}
      </div>
      {gapPct !== null && (
        <div className="mt-1 font-semibold" style={{ color: "#b9c0cf" }}>
          Close vs fit {gapPct >= 0 ? "+" : ""}
          {gapPct.toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function Dot(props: { cx?: number; cy?: number; payload?: ScatterRow }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  return <circle cx={cx} cy={cy} r={4.5} fill={payload.fill} stroke="var(--color-background)" strokeWidth={0.75} />;
}

function LatestRing(props: { cx?: number; cy?: number }) {
  const { cx, cy } = props;
  if (cx === undefined || cy === undefined) return null;
  return <circle cx={cx} cy={cy} r={8} fill="var(--color-background)" stroke={LATEST_RING} strokeWidth={2.5} />;
}

const axisTick = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

export function RegressionScatterChart({
  points,
  slope,
  intercept,
}: {
  points: RegressionChartPoint[];
  slope: number;
  intercept: number;
}) {
  if (points.length === 0) return null;
  const last = points.length - 1;
  const rows: ScatterRow[] = points.map((p, i) => ({
    date: p.date,
    driver: p.driver,
    close: p.close,
    model: p.model,
    fill: dateShade(last > 0 ? i / last : 1),
  }));
  const latest = rows[last];
  const xs = rows.map((r) => r.driver);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);

  return (
    <div className="space-y-2">
      <div className="h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, left: 8, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              type="number"
              dataKey="driver"
              domain={["auto", "auto"]}
              tickFormatter={axisTick}
              tick={{ fontSize: 12 }}
              label={{ value: "AUM MA, ₹ cr", position: "insideBottom", offset: -12, fontSize: 12 }}
            />
            <YAxis type="number" dataKey="close" domain={["auto", "auto"]} tickFormatter={axisTick} width={70} tick={{ fontSize: 12 }} />
            <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={rows} shape={<Dot />} isAnimationActive={false} />
            <ReferenceLine
              segment={[
                { x: xMin, y: slope * xMin + intercept },
                { x: xMax, y: slope * xMax + intercept },
              ]}
              stroke={FIT_LINE}
              strokeWidth={2}
              strokeDasharray="6 4"
              ifOverflow="extendDomain"
            />
            <Scatter data={[latest]} shape={<LatestRing />} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm" style={{ backgroundColor: dateShade(0) }} />
          Older
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm" style={{ backgroundColor: dateShade(1) }} />
          Recent
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-full border-2" style={{ borderColor: LATEST_RING }} />
          Latest ({formatShortDateWithYear(latest.date)})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: FIT_LINE }} />
          Fit
        </span>
      </div>
    </div>
  );
}
