"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmcValuation } from "@/hooks/use-amc-valuation";
import { computeRangeCutoffDate, filterByCutoff, RANGE_OPTIONS, type RangeOption } from "@/lib/aum/date-range";
import { computeBands, formatDayMonthYear, rangeTicks, type Bands } from "@/lib/valuation/bands";
import type { ValuationPoint } from "@/lib/valuation/store";
import { ValuationUploadPanel } from "./valuation-upload-panel";

// PE and Mcap/Sales band charts for the Stock Correlation tab, below the
// AUM MA -> Price scatter. Styled after the user's own Excel chart: navy
// series, solid grey average, dashed orange/red (+1/+2 SD) and light/dark
// green (-1/-2 SD) lines. Mean and SD come from the window shown, so the
// bands move with the tab's Range toggle, and so do the x-axis ticks
// (weekly on 3M up to quarterly on All).

const SERIES = "#1f2a5c";
const BAND_LINES: { key: keyof Pick<Bands, "mean" | "plus1" | "plus2" | "minus1" | "minus2">; label: string; color: string; dashed: boolean }[] = [
  { key: "mean", label: "Average", color: "#4b5563", dashed: false },
  { key: "plus1", label: "SD+1", color: "#e07b26", dashed: true },
  { key: "plus2", label: "SD+2", color: "#b22222", dashed: true },
  { key: "minus1", label: "SD-1", color: "#7cad5b", dashed: true },
  { key: "minus2", label: "SD-2", color: "#2f4f2f", dashed: true },
];

type Metric = "pe" | "mcapToSales";

interface ChartRow {
  date: string;
  value: number;
}

function BandTooltip({ active, payload, bands }: { active?: boolean; payload?: ReadonlyArray<{ payload?: ChartRow }>; bands: Bands }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const z = bands.sd !== 0 ? (row.value - bands.mean) / bands.sd : null;
  // Same fixed-dark card as the regression charts' tooltips.
  return (
    <div className="rounded-lg px-3 py-2.5 text-xs" style={{ backgroundColor: "#1b2130", color: "#eef1f6" }}>
      <div className="mb-1 font-semibold">{formatDayMonthYear(row.date)}</div>
      <div>{row.value.toFixed(2)}x</div>
      {z !== null && (
        <div className="mt-1" style={{ color: "#b9c0cf" }}>
          {z >= 0 ? "+" : ""}
          {z.toFixed(2)} SD vs mean
        </div>
      )}
    </div>
  );
}

function ValuationBandChart({
  points,
  metric,
  label,
  companyName,
  range,
}: {
  points: ValuationPoint[];
  metric: Metric;
  label: string;
  companyName: string;
  range: RangeOption;
}) {
  const view = useMemo(() => {
    const all: ChartRow[] = points.flatMap((p) => (p[metric] === null ? [] : [{ date: p.date, value: p[metric]! }]));
    const rows = filterByCutoff(all, computeRangeCutoffDate(all, range));
    const bands = computeBands(rows.map((r) => r.value));
    const ticks = rangeTicks(rows.map((r) => r.date), range);
    return { rows, bands, ticks, tickLabelByDate: new Map(ticks.map((t) => [rows[t.index].date, t.label])) };
  }, [points, metric, range]);

  const { rows, bands, ticks, tickLabelByDate } = view;
  if (!bands) {
    return <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Not enough {label} data for this range.</div>;
  }
  const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range;
  const span = `${formatDayMonthYear(rows[0].date)} to ${formatDayMonthYear(rows[rows.length - 1].date)}`;
  const chips = [
    { text: `Current ${bands.current.toFixed(1)}x`, strong: true },
    { text: `Mean ${bands.mean.toFixed(1)}x` },
    ...(bands.zScore !== null ? [{ text: `${bands.zScore >= 0 ? "+" : ""}${bands.zScore.toFixed(2)} SD vs mean` }] : []),
    { text: `−2 SD ${bands.minus2.toFixed(1)} · +2 SD ${bands.plus2.toFixed(1)}` },
  ];

  return (
    <div className="space-y-2 rounded-lg border bg-card p-4">
      <p className="text-center text-sm text-foreground/80">
        {companyName} | {label} – {range === "all" ? "all history" : `last ${rangeLabel}`} ({span})
      </p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {chips.map((c) => (
          <span
            key={c.text}
            className={`rounded-full px-2.5 py-0.5 text-xs tabular-nums ${c.strong ? "text-white" : "bg-muted text-foreground"}`}
            style={c.strong ? { backgroundColor: SERIES } : undefined}
          >
            {c.text}
          </span>
        ))}
      </div>
      <div className="h-[340px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid vertical={false} className="stroke-border" />
            <XAxis
              dataKey="date"
              ticks={ticks.map((t) => rows[t.index].date)}
              interval={0}
              tickFormatter={(d: string) => tickLabelByDate.get(d) ?? ""}
              angle={-45}
              textAnchor="end"
              height={52}
              tick={{ fontSize: 11 }}
            />
            <YAxis domain={[0, "auto"]} tickFormatter={(v: number) => v.toFixed(2)} width={52} tick={{ fontSize: 11 }} />
            <Tooltip content={<BandTooltip bands={bands} />} />
            {BAND_LINES.map((b) => (
              <ReferenceLine key={b.key} y={bands[b.key]} stroke={b.color} strokeWidth={2} strokeDasharray={b.dashed ? "8 6" : undefined} />
            ))}
            <Line type="linear" dataKey="value" stroke={SERIES} strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-6 border-t-[3px]" style={{ borderColor: SERIES }} />
          {label}
        </span>
        {BAND_LINES.map((b) => (
          <span key={b.key} className="flex items-center gap-1.5">
            <span className={`inline-block w-6 border-t-2 ${b.dashed ? "border-dashed" : ""}`} style={{ borderColor: b.color }} />
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ValuationBandCharts({ slug, range }: { slug: string; range: RangeOption }) {
  const { data, error, isLoading } = useAmcValuation(slug);

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[440px] w-full" />
        <Skeleton className="h-[440px] w-full" />
      </div>
    );
  } else if (error || !data) {
    body = <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Couldn&apos;t load PE data: {error?.message ?? "no response"}</div>;
  } else if (data.points.length === 0) {
    body = (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        No PE / Mcap-Sales data loaded yet for {data.companyName}. Drop the Ace Equity export below to add it.
      </div>
    );
  } else {
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <ValuationBandChart points={data.points} metric="pe" label="TTM PE (x)" companyName={data.companyName} range={range} />
        <ValuationBandChart points={data.points} metric="mcapToSales" label="Mcap / Sales (x)" companyName={data.companyName} range={range} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {body}
      <ValuationUploadPanel lastUpload={data?.lastUpload ?? null} />
    </div>
  );
}
