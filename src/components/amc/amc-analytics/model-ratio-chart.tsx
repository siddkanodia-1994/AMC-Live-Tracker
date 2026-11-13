"use client";

import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ModelRatioLadder, ModelRatioPoint } from "@/lib/amc-stock/model-ratio";
import { formatPriceInr, formatShortDateWithYear } from "@/lib/utils/format";

// AMC Analytics' Regression: each session's close ÷ the levels best-fit
// line's value, with the fit window's mean and ±1 / ±2 SD drawn across it
// (as the Ratio sub-tab's chart does for price ÷ AUM).
const RATIO_LINE = "#7c3aed";
const MEAN_LINE = "var(--color-foreground)";
const SD1_LINE = "#9a9ca1";
const SD2_LINE = "#c4c6ca";

function RatioTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: ModelRatioPoint }> }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="rounded-lg px-3 py-2.5 text-xs" style={{ backgroundColor: "#1b2130", color: "#eef1f6" }}>
      <div className="mb-1.5 font-semibold">{formatShortDateWithYear(row.date)}</div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: RATIO_LINE }} />
        Close ÷ Model: {row.ratio.toFixed(4)}
      </div>
      <div>Close: {formatPriceInr(row.close)}</div>
      <div>Model: {formatPriceInr(row.model)}</div>
    </div>
  );
}

export function ModelRatioChart({ ladder }: { ladder: ModelRatioLadder }) {
  const { meanRatio: m, stdDev: s } = ladder;
  const levels = [
    { y: m + 2 * s, label: "+2 SD", stroke: SD2_LINE, dash: "4 3" },
    { y: m + s, label: "+1 SD", stroke: SD1_LINE, dash: "4 3" },
    { y: m, label: "Mean", stroke: MEAN_LINE, dash: undefined },
    { y: m - s, label: "−1 SD", stroke: SD1_LINE, dash: "4 3" },
    { y: m - 2 * s, label: "−2 SD", stroke: SD2_LINE, dash: "4 3" },
  ];
  const values = ladder.points.map((p) => p.ratio).concat(levels.map((l) => l.y));
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.06;
  const last = ladder.points[ladder.points.length - 1];
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={ladder.points} margin={{ top: 8, right: 48, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="date" tickFormatter={formatShortDateWithYear} minTickGap={48} tick={{ fontSize: 12 }} />
          <YAxis domain={[lo - pad, hi + pad]} tickFormatter={(v: number) => v.toFixed(3)} width={56} tick={{ fontSize: 12 }} />
          <Tooltip content={<RatioTooltip />} />
          {levels.map((l) => (
            <ReferenceLine
              key={l.label}
              y={l.y}
              stroke={l.stroke}
              strokeDasharray={l.dash}
              label={{ value: l.label, position: "right", fontSize: 11, fill: "var(--color-muted-foreground)" }}
            />
          ))}
          <Line type="monotone" dataKey="ratio" name="Close ÷ Model" stroke={RATIO_LINE} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          {last && <ReferenceDot x={last.date} y={last.ratio} r={5} fill="var(--color-background)" stroke="#111827" strokeWidth={2.5} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
