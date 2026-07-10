"use client";

import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCr, formatPct, formatReportPeriodLabel, formatShortDate } from "@/lib/utils/format";
import type { AumHistoryPoint } from "@/lib/aum/history";

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

export function AumTrendChart({ data, mode = "absolute" }: { data: AumHistoryPoint[]; mode?: "absolute" | "change" }) {
  const yDomain = useMemo(() => computeYAxisDomain(data), [data]);
  const tickDecimals = useMemo(() => computeTickDecimals(yDomain), [yDomain]);
  const changeSeries = useMemo(() => computeDailyChangeSeries(data), [data]);
  const pctYDomain = useMemo(() => computePctYAxisDomain(changeSeries), [changeSeries]);

  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No history yet — a snapshot is captured once a day, check back tomorrow.
      </p>
    );
  }

  if (mode === "change") {
    return (
      <div className="h-64 w-full">
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
              dot={{ r: 3 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="date" tickFormatter={formatShortDate} tick={{ fontSize: 12 }} />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 12 }}
            tickFormatter={(v: number) => `${(v / 1000).toFixed(tickDecimals)}k`}
            width={50}
          />
          <Tooltip
            labelFormatter={(label) => (typeof label === "string" ? formatShortDate(label) : String(label ?? ""))}
            formatter={(value, name, item) => {
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
            dataKey="liveAumCr"
            name="Live AUM"
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
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
