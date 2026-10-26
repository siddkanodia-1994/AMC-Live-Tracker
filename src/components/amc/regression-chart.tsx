"use client";

import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPriceInr, formatShortDateWithYear } from "@/lib/utils/format";
import type { RegressionChartPoint } from "@/lib/amc-stock/regression-engine";

// Matched against the reference page's own screenshot via an interactive
// Artifact preview built from this AMC's real regression output, and
// confirmed by the user -- not an arbitrary choice.
const RICH_FILL = "#CDA97E"; // Close above model
const CHEAP_FILL = "#93A8DD"; // Close below model
const MODEL_LINE = "#3B63C9"; // also used by the tooltip's "Model" swatch below, so they match exactly

interface RegressionChartRow {
  date: string;
  close: number;
  model: number;
  richBand: [number, number] | null;
  cheapBand: [number, number] | null;
}

// Each point's gap between Close and Model becomes a shaded band on
// whichever side it falls -- a tan "richBand" when Close >= Model
// (trading above fair value) and a periwinkle "cheapBand" when Close <
// Model (trading below it). Deliberately distinct from the dashboard's
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

// Recharts' default <Tooltip> lists every series at this point, including
// the richBand/cheapBand helper series (each a 2-element array, which
// renders as a garbled value) -- this reads only the "close"/"model"
// entries by their dataKey and ignores the rest, matching the reference
// page's own tooltip exactly: a fixed-dark card (not the app's
// light/dark theme tokens, same as the reference's own tooltip looks
// identical regardless of its light-themed page around it), a swatch per
// series, and the derived "Close vs model ±X%" line.
function RegressionTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: string; value?: unknown }>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const close = payload.find((p) => p.dataKey === "close")?.value;
  const model = payload.find((p) => p.dataKey === "model")?.value;
  if (typeof close !== "number" || typeof model !== "number") return null;
  const gapPct = model !== 0 ? ((close - model) / model) * 100 : null;

  return (
    <div className="rounded-lg px-3 py-2.5 text-xs" style={{ backgroundColor: "#1b2130", color: "#eef1f6" }}>
      <div className="mb-1.5 font-semibold">{typeof label === "string" ? formatShortDateWithYear(label) : String(label ?? "")}</div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: "#eef1f6", border: "1px solid #8a93a6" }} />
        Close: {formatPriceInr(close)}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: MODEL_LINE }} />
        Model: {formatPriceInr(model)}
      </div>
      {gapPct !== null && (
        <div className="mt-1 font-semibold" style={{ color: "#b9c0cf" }}>
          Close vs model {gapPct >= 0 ? "+" : ""}
          {gapPct.toFixed(1)}%
        </div>
      )}
    </div>
  );
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
          <Tooltip content={<RegressionTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="richBand" name="Close above model" stroke="none" fill={RICH_FILL} fillOpacity={0.85} connectNulls={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="cheapBand" name="Close below model" stroke="none" fill={CHEAP_FILL} fillOpacity={0.85} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="close" name="Close" stroke="var(--color-foreground)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="model" name="Model (fair value)" stroke={MODEL_LINE} strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
