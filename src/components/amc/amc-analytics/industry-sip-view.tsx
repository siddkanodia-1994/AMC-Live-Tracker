"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthlyFlowPoint } from "@/lib/aum/industry-flows";
import { buildIndustrySipLedger, monthKey, monthLabel, monthShortLabel, shiftMonth, type IndustrySipRow } from "@/lib/aum/industry-sip";
import { formatLedgerInr, formatLedgerPct } from "@/lib/aum/period-ledger";
import { Pct } from "./sections";

// The Industry SIP section (below SIP & Score): AMFI's monthly industry SIP
// as a trend graph — the Summary tab's SIP Contributions Trend in the
// ledger look — above a period ledger of sums. Industry-wide, so the AMC
// tabs hide while it's open.

type Range = "1y" | "3y" | "5y" | "all";
const RANGES: { value: Range; label: string; months: number | null }[] = [
  { value: "1y", label: "1Y", months: 12 },
  { value: "3y", label: "3Y", months: 36 },
  { value: "5y", label: "5Y", months: 60 },
  { value: "all", label: "All", months: null },
];
const MONTH_COUNTS: { value: number | null; label: string }[] = [
  { value: 12, label: "12" },
  { value: 24, label: "24" },
  { value: 36, label: "36" },
  { value: null, label: "All" },
];

const pctText = (v: number) => formatLedgerPct(v)?.text ?? "—";

interface SeriesPoint {
  key: string;
  value: number;
  yoyPct: number | null;
}

// YoY comes from the full series (the first month of a 1Y view still needs
// the year before it); the range only trims what's shown and the bands.
function buildSeries(points: readonly MonthlyFlowPoint[]): SeriesPoint[] {
  const byKey = new Map(points.map((p) => [monthKey(p.monthEndDate), p.sipContributionsCr]));
  return [...byKey.keys()].sort().map((key) => {
    const value = byKey.get(key)!;
    const base = byKey.get(shiftMonth(key, -12));
    return { key, value, yoyPct: base ? value / base - 1 : null };
  });
}

// Population SD, as the Summary tab's chart.
function meanSd(values: number[]): { mean: number; sd: number; n: number } | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return { mean, sd, n: values.length };
}

// Round axis ends and ticks to a 1 / 2 / 2.5 / 5 step, so the axis reads
// 10,000 / 20,000 rather than the padded data range's own odd ends.
function niceScale(values: number[]): { domain: [number, number]; ticks: number[] } {
  if (values.length === 0) return { domain: [0, 1], ticks: [0, 1] };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi > lo ? hi - lo : Math.max(Math.abs(hi), 1);
  const rough = (span * 1.2) / 5;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= rough)!;
  const start = Math.floor((lo - span * 0.05) / step) * step;
  const end = Math.ceil((hi + span * 0.05) / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= end + step / 2; t += step) ticks.push(Number(t.toFixed(10)));
  return { domain: [start, end], ticks };
}

const BANDS = [
  { key: "plus2", label: "+2 SD", k: 2, color: "#a30c15" },
  { key: "plus1", label: "+1 SD", k: 1, color: "#e05a62" },
  { key: "mean", label: "Mean", k: 0, color: "#686b72" },
  { key: "minus1", label: "-1 SD", k: -1, color: "#3fa45a" },
  { key: "minus2", label: "-2 SD", k: -2, color: "#08711e" },
] as const;

function Segment<T extends string | number | null>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <span className="is-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.label} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

function TrendPanel({ points, latest }: { points: readonly MonthlyFlowPoint[]; latest: string }) {
  const [range, setRange] = useState<Range>("all");
  const [mode, setMode] = useState<"abs" | "yoy">("abs");
  const full = useMemo(() => buildSeries(points), [points]);
  const series = useMemo(() => {
    const months = RANGES.find((r) => r.value === range)?.months;
    return months ? full.slice(-months) : full;
  }, [full, range]);
  const yoys = series.map((p) => p.yoyPct).filter((v): v is number => v !== null);
  const stats = meanSd(yoys);
  const current = yoys.at(-1) ?? null;
  const z = stats && current !== null && stats.sd !== 0 ? (current - stats.mean) / stats.sd : null;
  const bandValues = stats ? BANDS.map((b) => stats.mean + b.k * stats.sd) : [];
  const absScale = niceScale(series.map((p) => p.value));
  const yoyScale = niceScale([...yoys, ...bandValues]);
  const tooltipStyle = { background: "#fff", border: "1px solid #d9d9d4", borderRadius: 0, fontSize: 12 };

  return (
    <section className="pl-panel" aria-label="Industry SIP trend">
      <div className="pl-band">
        Industry SIP contributions · trend <span className="pl-band-unit">₹ Cr · AMFI · data to {monthLabel(latest)}</span>
      </div>
      <div className="is-ctrl">
        <span>Range</span>
        <Segment label="Date range" options={RANGES} value={range} onChange={setRange} />
        <Segment
          label="Chart mode"
          options={[
            { value: "abs" as const, label: "Absolute" },
            { value: "yoy" as const, label: "YoY %" },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      {mode === "yoy" && stats && current !== null && z !== null && (
        <p className="is-read">
          Mean YoY {pctText(stats.mean)} · Current {pctText(current)} ·{" "}
          <span className={z >= 0 ? "is-z-pos" : "is-z-neg"}>
            Z-score {z >= 0 ? "+" : ""}
            {z.toFixed(2)}σ
          </span>{" "}
          · {stats.n} months
        </p>
      )}
      <div className="is-chart">
        <ResponsiveContainer width="100%" height="100%">
          {mode === "abs" ? (
            <LineChart data={series} margin={{ top: 12, right: 24, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="#eef0f3" vertical={false} />
              <XAxis dataKey="key" tickFormatter={monthShortLabel} tick={{ fontSize: 11, fill: "#686b72" }} minTickGap={24} />
              <YAxis
                domain={absScale.domain}
                ticks={absScale.ticks}
                tickFormatter={(v: number) => formatLedgerInr(v)}
                tick={{ fontSize: 11, fill: "#686b72" }}
                width={64}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(k) => monthLabel(String(k))}
                formatter={(v) => [`₹${formatLedgerInr(Number(v))} Cr`, "SIP"]}
              />
              <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          ) : (
            <LineChart data={series} margin={{ top: 12, right: 48, left: 8, bottom: 4 }}>
              <CartesianGrid stroke="#eef0f3" vertical={false} />
              <XAxis dataKey="key" tickFormatter={monthShortLabel} tick={{ fontSize: 11, fill: "#686b72" }} minTickGap={24} />
              <YAxis
                domain={yoyScale.domain}
                ticks={yoyScale.ticks}
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                tick={{ fontSize: 11, fill: "#686b72" }}
                width={48}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(k) => monthLabel(String(k))}
                formatter={(v) => [typeof v === "number" ? pctText(v) : "—", "YoY"]}
              />
              {stats &&
                BANDS.map((b) => (
                  <ReferenceLine
                    key={b.key}
                    y={stats.mean + b.k * stats.sd}
                    stroke={b.color}
                    strokeDasharray={b.k === 0 ? undefined : "4 4"}
                    label={{ value: b.label, position: "right", fontSize: 10, fill: b.color }}
                  />
                ))}
              <Line type="monotone" dataKey="yoyPct" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function Block({ title, step, rows, cur = true }: { title: string; step: string | null; rows: IndustrySipRow[]; cur?: boolean }) {
  return (
    <>
      <tr className="is-blk">
        <th scope="col">{title}</th>
        <td>Val (₹ Cr)</td>
        <td>{step ?? ""}</td>
        <td>YoY %</td>
      </tr>
      {rows.map((r, i) => (
        <tr key={r.key} className={cur && i === 0 ? "ss-cur" : r.muted ? "is-muted" : undefined}>
          <th scope="row">{r.label}</th>
          <td className={i === 0 && cur ? "ss-strong" : undefined}>{formatLedgerInr(r.value)}</td>
          <td className="ss-chg">{r.step !== undefined ? <Pct change={r.step} /> : null}</td>
          <td className="ss-chg">{r.yoy !== undefined ? <Pct change={r.yoy} /> : null}</td>
        </tr>
      ))}
    </>
  );
}

function LedgerPanel({ points }: { points: readonly MonthlyFlowPoint[] }) {
  const [months, setMonths] = useState<number | null>(12);
  const ledger = useMemo(() => buildIndustrySipLedger(points, months ?? points.length), [points, months]);
  if (!ledger) return null;
  return (
    <section className="pl-panel" aria-label="Industry SIP ledger">
      <div className="pl-band">
        Industry SIP contributions · ledger <span className="pl-band-unit">₹ Cr · sums of monthly SIP · AMFI</span>
      </div>
      <div className="is-ctrl">
        <span>Months</span>
        <Segment label="Months shown" options={MONTH_COUNTS} value={months} onChange={setMonths} />
      </div>
      <div className="ss-scroll">
        <table className="ss-t is-t">
          <tbody>
            <Block title="Financial Year" step={null} rows={ledger.financialYear} />
            <Block title="Quarter" step="QoQ %" rows={ledger.quarter} />
            <Block title="Month" step="MoM %" rows={ledger.month} />
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function IndustrySipView({ points }: { points: readonly MonthlyFlowPoint[] | undefined }) {
  if (!points) return <p className="aa-note">Loading AMFI&apos;s industry SIP…</p>;
  if (points.length === 0) return <p className="aa-note">No industry SIP data yet.</p>;
  const latest = monthKey([...points].sort((a, b) => (a.monthEndDate < b.monthEndDate ? -1 : 1)).at(-1)!.monthEndDate);
  return (
    <div className="is-view">
      <TrendPanel points={points} latest={latest} />
      <LedgerPanel points={points} />
      <p className="aa-note">
        Monthly SIP contributions across all mutual funds, as published by AMFI (the same figures as the Summary tab&apos;s Industry
        Flows). Quarters and years are sums of their months; YoY bands are the mean and ±1 / ±2 SD of the YoY % over the range shown.
      </p>
    </div>
  );
}
