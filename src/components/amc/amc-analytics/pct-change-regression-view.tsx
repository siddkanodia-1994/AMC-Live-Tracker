"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { DW_LOWER, DW_UPPER, MIN_NW_T, MIN_SESSIONS, Tile } from "@/components/amc/regression-deep-dive";
import { dateShade } from "@/components/amc/regression-scatter-chart";
import { PCT_TARGET_AVG_DAYS, type PctChangePoint, type PctChangeRegressionResult } from "@/lib/amc-stock/pct-change-regression";
import { formatCr, formatPct, formatPriceInr, formatShortDateWithYear } from "@/lib/utils/format";

// The AMC Analytics Regression section with "Levels (no % chg)" OFF, laid
// out like the levels deep-dive: price vs the % change line's target, the
// equation, the diagnostic tiles (holdout scored on the change itself),
// Actual vs Model daily change, and the %ΔAUM → %ΔPrice scatter. Colours
// match the levels charts.
const FIT_LINE = "#3B63C9";
const ACTUAL_LINE = "#9aa3b2";
const LATEST_RING = "#111827";

function pct(v: number, digits = 2): string {
  return `${v >= 0 ? "" : "−"}${Math.abs(v * 100).toFixed(digits)}%`;
}

function ChangeTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: PctChangePoint }> }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="rounded-lg px-3 py-2.5 text-xs" style={{ backgroundColor: "#1b2130", color: "#eef1f6" }}>
      <div className="mb-1.5 font-semibold">{formatShortDateWithYear(row.date)}</div>
      <div>AUM MA change: {pct(row.aumChg, 3)}</div>
      <div>Price change: {pct(row.priceChg)}</div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: FIT_LINE }} />
        Model: {pct(row.model)}
      </div>
    </div>
  );
}

function Dot(props: { cx?: number; cy?: number; payload?: PctChangePoint & { fill: string } }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  return <circle cx={cx} cy={cy} r={3.5} fill={payload.fill} stroke="var(--color-background)" strokeWidth={0.5} />;
}

function LatestRing(props: { cx?: number; cy?: number }) {
  const { cx, cy } = props;
  if (cx === undefined || cy === undefined) return null;
  return <circle cx={cx} cy={cy} r={7} fill="var(--color-background)" stroke={LATEST_RING} strokeWidth={2.5} />;
}

const axisPct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function PctChangeRegressionView({
  result,
  tradingSymbol,
  maWindow,
  extraLagDays,
}: {
  result: PctChangeRegressionResult | null;
  tradingSymbol: string;
  maWindow: number;
  extraLagDays: number;
}) {
  if (!result) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        Not enough aligned daily changes to fit the % change model for this AMC at this range.
      </div>
    );
  }
  const lagTag = extraLagDays === 0 ? "t" : `t−${extraLagDays}`;
  const lagLabel = extraLagDays === 0 ? "AUM same-day" : `AUM lagged ${extraLagDays} session${extraLagDays === 1 ? "" : "s"}`;
  const dwOk = result.durbinWatson !== null && result.durbinWatson >= DW_LOWER && result.durbinWatson <= DW_UPPER;
  const last = result.points.length - 1;
  const rows = result.points.map((p, i) => ({ ...p, fill: dateShade(last > 0 ? i / last : 1) }));
  const latest = rows[last];
  const xMin = Math.min(...rows.map((r) => r.aumChg));
  const xMax = Math.max(...rows.map((r) => r.aumChg));
  const t = result.target;
  const gapPct = t && t.targetPrice !== 0 ? ((t.basePrice - t.targetPrice) / t.targetPrice) * 100 : null;

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border bg-card p-4">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Price vs AUM Target (daily % change)</p>
        {t ? (
          <>
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-mono text-2xl font-semibold tabular-nums">{formatPriceInr(t.basePrice)}</span>
              <span className="text-xs text-muted-foreground">vs target</span>
              <span className="font-mono text-2xl font-semibold tabular-nums text-blue-600 dark:text-blue-400">{formatPriceInr(t.targetPrice)}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Price is{" "}
              <span className={gapPct !== null && gapPct < 0 ? "font-semibold text-emerald-600 dark:text-emerald-400" : "font-semibold text-red-600 dark:text-red-400"}>
                {gapPct === null ? "—" : `${formatPct(Math.abs(gapPct) / 100)} ${gapPct < 0 ? "below" : "above"}`}
              </span>{" "}
              the target. Live AUM {formatCr(t.liveAumCr)} is {pct(t.aumGap)} vs its {PCT_TARGET_AVG_DAYS}-day average {formatCr(t.avgAumCr)}; on the
              line that is a {pct(t.priceMove)} price move from today&apos;s {formatPriceInr(t.basePrice)}.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Not enough AUM history for a {PCT_TARGET_AVG_DAYS}-day average.</p>
        )}
        <div className="overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-xs">
          %ΔPrice = {result.beta.toFixed(3)} × %ΔAumMA{maWindow}[{lagTag}] {result.alpha >= 0 ? "+" : "−"} {Math.abs(result.alpha * 100).toFixed(3)}%
        </div>
        <div className="font-mono text-[11px] leading-relaxed text-muted-foreground">
          n {result.n} daily changes · fitted from {formatShortDateWithYear(result.fittedFrom)} · {lagLabel} · R² {(result.r2 * 100).toFixed(2)}%
          {result.pearsonR !== null ? `, r ${result.pearsonR.toFixed(2)}` : ""} (in-sample) · {tradingSymbol}.NS raw close {formatShortDateWithYear(result.fittedTo)}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Levels off: each session&apos;s % change in the raw share price vs its % change in the {maWindow > 1 ? `${maWindow}-day average AUM` : "live AUM"}{" "}
          (the same daily changes as Stock Correlation&apos;s Corr/R² with AUM-only avg on), and target = today&apos;s price × (1 + the line&apos;s
          move at the live vs {PCT_TARGET_AVG_DAYS}-day average AUM gap).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile pass={result.n >= MIN_SESSIONS} head={`${result.n} daily changes`} sub={`needs ≥ ${MIN_SESSIONS}`} />
        <Tile
          pass={Math.abs(result.neweyWest.tStat) >= MIN_NW_T}
          head={`NW t = ${result.neweyWest.tStat.toFixed(2)}`}
          sub={`β ${Math.abs(result.neweyWest.tStat) >= MIN_NW_T ? "significant" : "not significant"} (needs ≥${MIN_NW_T}), ${result.neweyWest.lags} lags`}
        />
        {result.holdout ? (
          <Tile
            pass={result.holdout.modelBeatsNaive}
            head={`Holdout ${result.holdout.modelMaePp.toFixed(2)} vs ${result.holdout.naiveMaePp.toFixed(2)} pp`}
            sub={`${result.holdout.modelBeatsNaive ? "beats" : "loses to"} "price unchanged" over the last ${result.holdout.holdoutSessions} sessions`}
          />
        ) : (
          <Tile pass={false} head="Holdout" sub="Insufficient sessions for a holdout test" />
        )}
        <Tile
          pass={dwOk}
          head={`Durbin–Watson ${result.durbinWatson !== null ? result.durbinWatson.toFixed(2) : "—"}`}
          sub={dwOk ? "no strong autocorrelation" : "errors autocorrelated"}
        />
      </div>

      <div className="space-y-1 rounded-lg border bg-card p-4">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Daily % change: Actual vs Model</p>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={result.points} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tickFormatter={(d: string) => formatShortDateWithYear(d)} minTickGap={48} tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={axisPct} width={56} tick={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="var(--color-muted-foreground)" strokeOpacity={0.5} />
              <Tooltip content={<ChangeTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line name={`${tradingSymbol} price change`} dataKey="priceChg" stroke={ACTUAL_LINE} strokeWidth={1} dot={false} isAnimationActive={false} />
              <Line name="Model" dataKey="model" stroke={FIT_LINE} strokeWidth={1.75} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="space-y-1 rounded-lg border bg-card p-4">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold tracking-wide uppercase">%ΔAUM MA{maWindow} → %ΔPrice</span> · each session, shaded by date · {lagLabel}
        </p>
        <div className="h-[340px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 16, left: 8, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                type="number"
                dataKey="aumChg"
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => `${(v * 100).toFixed(2)}%`}
                tick={{ fontSize: 12 }}
                label={{ value: `AUM MA${maWindow} daily change`, position: "insideBottom", offset: -12, fontSize: 12 }}
              />
              <YAxis type="number" dataKey="priceChg" domain={["auto", "auto"]} tickFormatter={axisPct} width={56} tick={{ fontSize: 12 }} />
              <Tooltip content={<ChangeTooltip />} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={rows} shape={<Dot />} isAnimationActive={false} />
              <ReferenceLine
                segment={[
                  { x: xMin, y: result.alpha + result.beta * xMin },
                  { x: xMax, y: result.alpha + result.beta * xMax },
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
    </div>
  );
}
