"use client";

import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPriceInr, formatShortDateWithYear } from "@/lib/utils/format";
import type { RegressionChartPoint } from "@/lib/amc-stock/regression-engine";

interface RegressionChartRow {
  date: string;
  close: number;
  model: number;
  richBand: [number, number] | null;
  cheapBand: [number, number] | null;
}

// Each point's gap between Close and Model becomes a shaded band on
// whichever side it falls -- an amber "richBand" when Close >= Model
// (trading above fair value) and a blue "cheapBand" when Close < Model
// (trading below it). Deliberately amber/blue rather than the dashboard's
// usual red/green good-vs-bad convention, since this same panel already
// uses red/green elsewhere (the "X% above/below" sentence) and a second,
// different meaning for the same colors on one screen would be confusing
// -- confirmed with the user via the design-review artifact.
function buildChartRows(points: RegressionChartPoint[]): RegressionChartRow[] {
  return points.map(({ date, close, model }) => ({
    date,
    close,
    model,
    richBand: close >= model ? [model, close] : null,
    cheapBand: close < model ? [close, model] : null,
  }));
}

export function RegressionChart({ points }: { points: RegressionChartPoint[] }) {
  const data = buildChartRows(points);

  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="date" tickFormatter={formatShortDateWithYear} tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v: number) => formatPriceInr(v)} width={70} tick={{ fontSize: 12 }} domain={["auto", "auto"]} />
          <Tooltip
            labelFormatter={(label) => (typeof label === "string" ? formatShortDateWithYear(label) : String(label ?? ""))}
            formatter={(value) => (typeof value === "number" ? formatPriceInr(value) : String(value))}
            contentStyle={{ fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="richBand" name="Close above model" stroke="none" fill="var(--color-amber-400)" fillOpacity={0.25} connectNulls={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="cheapBand" name="Close below model" stroke="none" fill="var(--color-blue-400)" fillOpacity={0.25} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="close" name="Close" stroke="var(--color-foreground)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="model" name="Model (fair value)" stroke="var(--color-blue-500)" strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
