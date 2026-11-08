"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmcValuation } from "@/hooks/use-amc-valuation";
import { computeRangeCutoffDate, filterByCutoff, RANGE_OPTIONS, type RangeOption } from "@/lib/aum/date-range";
import { computeBands, formatDayMonthYear, niceYAxis, rangeTicks, type Bands } from "@/lib/valuation/bands";
import type { ValuationPoint } from "@/lib/valuation/store";
import { ValuationUploadPanel } from "./valuation-upload-panel";

// PE and Mcap/Sales band charts for the Stock Correlation tab, below the
// AUM MA -> Price scatter. Styled after the user's own Excel chart: navy
// series, solid grey average, dashed orange/red (+1/+2 SD) and light/dark
// green (-1/-2 SD) lines. They have their own Valuation range toggle (one
// for both charts, independent of the tab's Range). Mean and SD come from
// the window shown, the x-axis ticks follow the range (weekly on 3M up to
// quarterly on All), and the y-axis fits the window's values and bands.

const DEFAULT_RANGE: RangeOption = "3y";

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

function TooltipRow({ color, label, value, dashed }: { color: string; label: string; value: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-2 tabular-nums">
      <span className={`inline-block w-3.5 border-t-2 ${dashed ? "border-dashed" : ""}`} style={{ borderColor: color }} />
      <span className="flex-1">{label}</span>
      <span>{value}</span>
    </div>
  );
}

// The navy series, grey average and dark-green SD-2 vanish on the dark
// tooltip card, so their swatches get lighter shades of the same colours.
const TOOLTIP_SWATCH: Partial<Record<(typeof BAND_LINES)[number]["key"], string>> = { mean: "#c5cad3", minus2: "#6fa36f" };

// The band lines are ReferenceLines, which recharts leaves out of the hover
// payload -- so list them here from `bands` (as the Chart.js mockup did).
function BandTooltip({
  active,
  payload,
  bands,
  seriesLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ChartRow }>;
  bands: Bands;
  seriesLabel: string;
}) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const z = bands.sd !== 0 ? (row.value - bands.mean) / bands.sd : null;
  // Same fixed-dark card as the regression charts' tooltips.
  return (
    <div className="min-w-[180px] space-y-0.5 rounded-lg px-3 py-2.5 text-xs" style={{ backgroundColor: "#1b2130", color: "#eef1f6" }}>
      <div className="mb-1 font-semibold">{formatDayMonthYear(row.date)}</div>
      <TooltipRow color="#8fa3ff" label={seriesLabel} value={`${row.value.toFixed(2)}x`} />
      {BAND_LINES.map((b) => (
        <TooltipRow key={b.key} color={TOOLTIP_SWATCH[b.key] ?? b.color} label={b.label} value={`${bands[b.key].toFixed(2)}x`} dashed={b.dashed} />
      ))}
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
    const yAxis = bands ? niceYAxis(rows.map((r) => r.value), bands) : null;
    return { rows, bands, ticks, yAxis, tickLabelByDate: new Map(ticks.map((t) => [rows[t.index].date, t.label])) };
  }, [points, metric, range]);

  const { rows, bands, ticks, yAxis, tickLabelByDate } = view;
  if (!bands || !yAxis) {
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
            <YAxis
              domain={[yAxis.min, yAxis.max]}
              ticks={yAxis.ticks}
              interval={0}
              tickFormatter={(v: number) => v.toFixed(2)}
              width={52}
              tick={{ fontSize: 11 }}
            />
            <Tooltip content={<BandTooltip bands={bands} seriesLabel={label} />} />
            {BAND_LINES.map((b) => (
              <ReferenceLine key={b.key} y={bands[b.key]} stroke={b.color} strokeWidth={2} strokeDasharray={b.dashed ? "8 6" : undefined} />
            ))}
            <Line type="linear" dataKey="value" stroke={SERIES} strokeWidth={2.5} dot={false} isAnimationActive={false} />
            {/* Invisible flat lines, only so hovering marks the cursor's date on each band with a dot. */}
            {BAND_LINES.map((b) => (
              <Line
                key={`hover-${b.key}`}
                dataKey={() => bands[b.key]}
                stroke="none"
                dot={false}
                activeDot={{ r: 4, fill: b.color, stroke: "#fff", strokeWidth: 1 }}
                legendType="none"
                isAnimationActive={false}
              />
            ))}
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

function ValuationRangeToggle({ value, onChange }: { value: RangeOption; onChange: (v: RangeOption) => void }) {
  // Same look as the tab's own ButtonGroup controls.
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Valuation range">
      <span className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">Valuation range</span>
      {RANGE_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={
            o.value === value
              ? "rounded-md bg-foreground px-2 py-1 text-xs text-background"
              : "rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ValuationBandCharts({
  slug,
  amcOptions,
  onSlugChange,
}: {
  slug: string;
  // The 8 listed AMCs, labelled by company name. Picking one calls
  // onSlugChange, which the tab wires to its shared AMC selection -- so this
  // dropdown and the deep-dive's stay in sync both ways.
  amcOptions: { slug: string; label: string }[];
  onSlugChange: (slug: string) => void;
}) {
  const { data, error, isLoading } = useAmcValuation(slug);
  // Kept across AMC switches: this component stays mounted, only `slug` changes.
  const [range, setRange] = useState<RangeOption>(DEFAULT_RANGE);

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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background p-3">
        <span className="text-sm font-semibold">Valuation bands · PE and Mcap / Sales</span>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <label htmlFor="valuation-amc-select" className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
              AMC
            </label>
            <select
              id="valuation-amc-select"
              value={slug}
              onChange={(e) => onSlugChange(e.target.value)}
              className="max-w-xs truncate rounded-md border bg-card px-2 py-1 text-xs text-foreground"
            >
              {amcOptions.map((o) => (
                <option key={o.slug} value={o.slug}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <ValuationRangeToggle value={range} onChange={setRange} />
        </div>
      </div>
      {data?.staleSince && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          A quarter ended on {formatDayMonthYear(data.staleSince)} since the last Ace Equity file, so the TTM earnings used for the
          latest days may be out of date. Upload the latest export to correct them.
        </p>
      )}
      {body}
      {data?.provisionalFrom && data.provisionalAnchorDate && (
        <p className="text-xs text-muted-foreground">
          From {formatDayMonthYear(data.provisionalFrom)}: price-updated daily from DHAN closes, with TTM EPS and sales held at the
          last Ace Equity file ({formatDayMonthYear(data.provisionalAnchorDate)}). The next upload replaces these days.
        </p>
      )}
      <ValuationUploadPanel lastUpload={data?.lastUpload ?? null} />
    </div>
  );
}
