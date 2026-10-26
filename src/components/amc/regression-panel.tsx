"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { useAmcStockCorrelations } from "@/hooks/use-amc-stock-correlations";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatCr, formatPct, formatPriceInr, formatShortDateWithYear } from "@/lib/utils/format";
import { RANGE_OPTIONS, type RangeOption } from "@/lib/aum/date-range";
import {
  MA_WINDOW_OPTIONS,
  EXTRA_LAG_OPTIONS,
  computeRegressionResult,
  type MaWindow,
  type ExtraLagDays,
  type RegressionResult,
} from "@/lib/amc-stock/regression-engine";
import { RegressionChart } from "./regression-chart";

const selectClass =
  "min-w-0 max-w-[260px] rounded-md border bg-background px-2 py-1 text-sm hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

const DEFAULT_SLUG = "hdfc-mutual-fund";
const DEFAULT_MA_WINDOW: MaWindow = 45;
const DEFAULT_EXTRA_LAG: ExtraLagDays = 0;
const DEFAULT_RANGE: RangeOption = "3y";

const MIN_SESSIONS = 60;
const MIN_NW_T = 2;
const MIN_DRIVER_VARIATION_PCT = 10;
const DW_LOWER = 1.5;
const DW_UPPER = 2.5;

function formatSigma(sigma: number): string {
  return `${sigma >= 0 ? "+" : "−"}${Math.abs(sigma).toFixed(1)}σ`;
}

function Tile({ pass, head, sub }: { pass: boolean; head: string; sub: string }) {
  return (
    <div
      className={
        pass
          ? "rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-900 dark:bg-emerald-950/40"
          : "rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/40"
      }
    >
      {pass ? (
        <CheckCircle2 className="mb-1 size-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <TriangleAlert className="mb-1 size-3.5 text-amber-600 dark:text-amber-400" />
      )}
      <div className="font-mono font-semibold text-foreground">{head}</div>
      <div className="mt-0.5 text-muted-foreground">{sub}</div>
    </div>
  );
}

function ButtonGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-[10px] font-bold tracking-wide text-muted-foreground uppercase">{label}</span>
      {options.map((o) => (
        <button
          key={String(o.value)}
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

export function RegressionPanel() {
  const { data } = useAmcStockCorrelations();
  const [slug, setSlug] = useState(DEFAULT_SLUG);
  const [maWindow, setMaWindow] = useState<MaWindow>(DEFAULT_MA_WINDOW);
  const [extraLagDays, setExtraLagDays] = useState<ExtraLagDays>(DEFAULT_EXTRA_LAG);
  const [range, setRange] = useState<RangeOption>(DEFAULT_RANGE);

  const entry = data?.amcs.find((a) => a.slug === slug);

  const result: RegressionResult | null = useMemo(() => {
    if (!entry) return null;
    return computeRegressionResult(entry.aumHistory, entry.stockPriceSeries, { maWindow, extraLagDays, range });
  }, [entry, maWindow, extraLagDays, range]);

  const r2ByWindow = useMemo(() => {
    if (!entry) return null;
    return MA_WINDOW_OPTIONS.map((o) => ({
      label: o.label,
      r2: computeRegressionResult(entry.aumHistory, entry.stockPriceSeries, { maWindow: o.value, extraLagDays, range })?.r2 ?? null,
    }));
  }, [entry, extraLagDays, range]);

  if (!data) {
    return <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const totalLag = 1 + extraLagDays;
  const fairValueGapPct = result && result.latestPrice !== 0 ? ((result.latestPrice - result.fairValueAtLatest) / result.fairValueAtLatest) * 100 : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2">
          <label htmlFor="regression-amc" className="text-xs text-muted-foreground">
            AMC
          </label>
          <select id="regression-amc" value={slug} onChange={(e) => setSlug(e.target.value)} className={selectClass}>
            {data.amcs.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.overviewName}
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs text-muted-foreground">
          Updated <RelativeTime iso={data.computedAt} />
        </span>
      </div>

      {!entry || !result ? (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Not enough aligned AUM/price history to fit a regression for this AMC at this range.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2 rounded-lg border bg-card p-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Price vs AUM Fair Value</p>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-mono text-2xl font-semibold tabular-nums">{formatPriceInr(result.latestPrice)}</span>
                <span className="text-xs text-muted-foreground">vs fair value</span>
                <span className="font-mono text-2xl font-semibold tabular-nums text-blue-600 dark:text-blue-400">{formatPriceInr(result.fairValueAtLatest)}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Price is{" "}
                <span className={fairValueGapPct !== null && fairValueGapPct < 0 ? "font-semibold text-emerald-600 dark:text-emerald-400" : "font-semibold text-red-600 dark:text-red-400"}>
                  {fairValueGapPct === null ? "—" : `${formatPct(Math.abs(fairValueGapPct) / 100)} ${fairValueGapPct < 0 ? "below" : "above"}`}
                </span>{" "}
                the model.{" "}
                {result.holdout ? (
                  <>
                    The model{" "}
                    <span className={result.holdout.modelBeatsNaive ? "font-semibold text-emerald-600 dark:text-emerald-400" : "font-semibold text-red-600 dark:text-red-400"}>
                      {result.holdout.modelBeatsNaive ? "beats" : "loses to"}
                    </span>{" "}
                    &ldquo;price unchanged&rdquo; out of sample ({result.holdout.modelMapePct.toFixed(1)}% vs {result.holdout.naiveMapePct.toFixed(1)}% error): read the gap as context, not a
                    signal.
                  </>
                ) : (
                  "Not enough sessions for an out-of-sample holdout test."
                )}
              </p>
              <div className="overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-xs">
                Price = {result.slope.toFixed(result.slope < 0.01 ? 6 : 4)} × AumMA{maWindow}[t−{totalLag}] {result.intercept >= 0 ? "+" : "−"} {Math.abs(result.intercept).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </div>
              <div className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                n {result.n} sessions · fitted from {formatShortDateWithYear(result.fittedFrom)} · AUM lagged {totalLag} session{totalLag === 1 ? "" : "s"} · R² {result.r2.toFixed(2)}
                {result.pearsonR !== null ? `, r ${result.pearsonR.toFixed(2)}` : ""} (in-sample) · {entry.tradingSymbol}.NS close {formatShortDateWithYear(result.fittedTo)}
              </div>
              {result.estimatedSessionCount > 0 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  {result.estimatedSessionCount} of {result.n} sessions include AUM from before 1 Jan 2026 — index-interpolated, not measured.
                </p>
              )}
            </div>

            <div className="space-y-2 rounded-lg border bg-card p-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Price ÷ AUM MA{maWindow}</p>
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="font-mono text-2xl font-semibold tabular-nums">{result.currentRatio !== null ? result.currentRatio.toFixed(5) : "—"}</span>
                <span className="text-xs text-muted-foreground">
                  mean {result.ratioMean !== null ? result.ratioMean.toFixed(5) : "—"} · σ {result.ratioStdDev !== null ? result.ratioStdDev.toFixed(5) : "—"}
                </span>
              </div>
              {result.currentSigma !== null && result.ratioMean !== null && result.ratioStdDev !== null ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {formatSigma(result.currentSigma)}: {result.currentSigma < 0 ? "low" : "high"} against its fit-window average
                  </p>
                  <div className="relative my-4 h-1.5 rounded-full bg-muted">
                    <div
                      className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
                      style={{ left: `${Math.max(0, Math.min(100, ((result.currentSigma + 2) / 4) * 100))}%`, transform: "translate(-50%, -50%)" }}
                    />
                  </div>
                  <div className="flex justify-between font-mono text-[10.5px] text-muted-foreground">
                    <span>−2σ {(result.ratioMean - 2 * result.ratioStdDev).toFixed(5)}</span>
                    <span>mean {result.ratioMean.toFixed(5)}</span>
                    <span>+2σ {(result.ratioMean + 2 * result.ratioStdDev).toFixed(5)}</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Not enough history to compute a stable ratio distribution.</p>
              )}
              {result.priceAtMeanRatio !== null && (
                <p className="text-sm text-muted-foreground">
                  At the average ratio the price would be {formatPriceInr(result.priceAtMeanRatio)} (MA {formatCr(result.latestDriver)}).
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Tile pass={result.n >= MIN_SESSIONS} head={`${result.n} sessions`} sub={`needs ≥ ${MIN_SESSIONS}`} />
            <Tile
              pass={Math.abs(result.neweyWest.tStat) >= MIN_NW_T}
              head={`NW t = ${result.neweyWest.tStat.toFixed(2)}`}
              sub={`significant (needs ≥${MIN_NW_T}), ${result.neweyWest.lags} lags`}
            />
            <Tile
              pass={result.driverVariationPct >= MIN_DRIVER_VARIATION_PCT}
              head={`AUM MA ${formatCr(result.driverMin)}–${formatCr(result.driverMax)}`}
              sub={`moved ${result.driverVariationPct.toFixed(0)}% over the fit (needs ≥${MIN_DRIVER_VARIATION_PCT}%)`}
            />
            {result.holdout ? (
              <Tile
                pass={result.holdout.modelBeatsNaive}
                head={`Holdout ${result.holdout.modelMapePct.toFixed(1)}% vs ${result.holdout.naiveMapePct.toFixed(1)}%`}
                sub={`${result.holdout.modelBeatsNaive ? "beats" : "loses to"} "price unchanged" over the last ${result.holdout.holdoutSessions} sessions`}
              />
            ) : (
              <Tile pass={false} head="Holdout" sub="Insufficient sessions for a holdout test" />
            )}
            <Tile
              pass={result.durbinWatson !== null && result.durbinWatson >= DW_LOWER && result.durbinWatson <= DW_UPPER}
              head={`Durbin–Watson ${result.durbinWatson !== null ? result.durbinWatson.toFixed(2) : "—"}`}
              sub={result.durbinWatson !== null && result.durbinWatson >= DW_LOWER && result.durbinWatson <= DW_UPPER ? "no strong autocorrelation" : "errors autocorrelated: gaps persist for weeks"}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-3">
            <ButtonGroup label="MA Window" options={MA_WINDOW_OPTIONS} value={maWindow} onChange={setMaWindow} />
            <ButtonGroup label="Extra Lag" options={EXTRA_LAG_OPTIONS} value={extraLagDays} onChange={setExtraLagDays} />
            <ButtonGroup label="Range" options={RANGE_OPTIONS} value={range} onChange={setRange} />
            {r2ByWindow && (
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                R² by window (in-sample): {r2ByWindow.map((w) => `${w.label} ${w.r2 !== null ? w.r2.toFixed(2) : "—"}`).join(" · ")}
              </span>
            )}
          </div>

          <div className="space-y-1 rounded-lg border bg-card p-4">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Share Price: Actual vs Model</p>
            <RegressionChart points={result.chartPoints} />
          </div>
        </>
      )}
    </div>
  );
}
