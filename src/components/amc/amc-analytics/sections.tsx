"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";
import { AumTrendChart } from "@/components/amc/aum-trend-chart";
import { AsideCard, RegressionDeepDive } from "@/components/amc/regression-deep-dive";
import { ValuationBandCharts } from "@/components/amc/valuation-band-charts";
import {
  computeAumWhatIf,
  parseAumInput,
  whatIfStartingAum,
  WHAT_IF_AUM_DAYS_OPTIONS,
  DEFAULT_WHAT_IF_AUM_DAYS,
  type RegressionLine,
} from "@/lib/amc-stock/aum-what-if";
import { computeRegressionResult, type ExtraLagDays } from "@/lib/amc-stock/regression-engine";
import { computePctChangeRegression } from "@/lib/amc-stock/pct-change-regression";
import { computeModelRatioLadder, modelRatioPrice, type ModelRatioLadder } from "@/lib/amc-stock/model-ratio";
import { ModelRatioChart } from "./model-ratio-chart";
import { PctChangeRegressionView } from "./pct-change-regression-view";
import { FitStatGrid } from "./fit-stat-strip";
import { computeFitCorrelation } from "@/lib/amc-stock/fit-stats";
import type { StockCorrelationDefaults } from "@/lib/amc-stock/correlation-defaults";
import type { AmcStockCorrelationEntry } from "@/lib/amc-stock/correlation-summary";
import { RANGE_OPTIONS, type RangeOption } from "@/lib/aum/date-range";
import { trimToLastContinuousRun } from "@/lib/aum/series-math";
import { formatPct, formatPriceInr, formatShortDateWithYear } from "@/lib/utils/format";
import { formatLedgerInr, formatLedgerPct } from "@/lib/aum/period-ledger";
import { computeValuationBlock } from "@/lib/valuation/valuation-block";
import type { AmcAnalyticsField, AmcAnalyticsInputs, AmcAnalyticsManual } from "@/lib/aum/amc-analytics-inputs";
import { saveAmcInput } from "@/hooks/use-amc-analytics-inputs";
import { useAmcValuation } from "@/hooks/use-amc-valuation";
import { withLiveValuationPoint } from "@/lib/valuation/provisional";
import { computeRatioLadder, RATIO_LADDER_SDS, type RatioLadder } from "@/lib/valuation/ratio-ladder";
import { computeTargetPrices, SCENARIO_KEYS, type TargetPriceTable, type ValuationMethodKey } from "@/lib/valuation/target-price";
import {
  CUSTOM_AUM_DAYS,
  DEFAULT_BEST_FIT_AUM_DAYS,
  DEFAULT_BEST_FIT_AUM_PCT,
  DEFAULT_VALUATION_RATIO_DAYS,
  DEFAULT_VALUATION_WEIGHTS,
  isBestFitAumPct,
  isValuationAvgDays,
  MAX_VALUATION_AVG_DAYS,
  MIN_VALUATION_AVG_DAYS,
  RATIO_TODAY_AUM_OPTIONS,
  VALUATION_AUM_DAYS_OPTIONS,
  VALUATION_WEIGHT_OPTIONS,
  type ValuationWeights,
} from "@/lib/valuation/valuation-settings";

// The AMC Analytics tab's per-AMC sections beyond the AUM Summary ledger.
// Each one reuses the dashboard's existing maths (and, where one exists,
// its component) with the SAME saved Stock Correlation settings, so its
// numbers equal the Stock Correlation / Regression tabs' for the same AMC.

/** The regression the Stock Correlation table fits for this AMC, at the saved settings. */
export function useSavedRegression(entry: AmcStockCorrelationEntry | undefined, defaults: StockCorrelationDefaults | undefined) {
  return useMemo(() => {
    if (!entry || !defaults) return null;
    return computeRegressionResult(entry.aumHistory, entry.stockPriceSeries, {
      maWindow: defaults.maDays,
      extraLagDays: defaults.extraLagDays as ExtraLagDays,
      range: defaults.range,
    });
  }, [entry, defaults]);
}

function lineOf(result: ReturnType<typeof computeRegressionResult>): RegressionLine | null {
  return result ? { slope: result.slope, intercept: result.intercept, driverMin: result.driverMin, driverMax: result.driverMax } : null;
}

export function Pct({ change }: { change: number | null }) {
  const p = formatLedgerPct(change);
  return <span className={`pl-chg pl-chg--${p?.tone ?? "neu"}`}>{p?.text ?? "—"}</span>;
}

function rupees(v: number | null): string {
  return v == null || !Number.isFinite(v) ? "—" : `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Panel({ title, unit, children }: { title: string; unit?: string; children: React.ReactNode }) {
  return (
    <section className="pl-panel" aria-label={title}>
      <div className="pl-band">
        {title} {unit && <span className="pl-band-unit">{unit}</span>}
      </div>
      {children}
    </section>
  );
}

// ── AUM Predictor: the Stock Correlation "AUM what-if" for one AMC ────────
export function AumPredictorSection({
  entry,
  defaults,
  priceIsLive = false,
}: {
  entry: AmcStockCorrelationEntry | undefined;
  defaults: StockCorrelationDefaults | undefined;
  /** The history's last price is today's live one (the shell lays it on). */
  priceIsLive?: boolean;
}) {
  const result = useSavedRegression(entry, defaults);
  const line = lineOf(result);
  const [days, setDays] = useState<number | null>(null);
  const [typed, setTyped] = useState<Record<string, number | null>>({});
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!entry || !defaults) return null;

  const whatIfDays = days ?? defaults.whatIfAumDays ?? DEFAULT_WHAT_IF_AUM_DAYS;
  const daily = trimToLastContinuousRun(entry.aumHistory).map((d) => d.liveAumCr);
  const startAum = whatIfStartingAum(daily, whatIfDays);
  const savedInput = defaults.aumInputs?.[entry.slug] ?? null;
  const inputAum = entry.slug in typed ? typed[entry.slug] : savedInput;
  const aum = inputAum ?? startAum;
  // Same "current price" the table's what-if uses: the latest stored close.
  const currentPrice = entry.stockPriceSeries.at(-1)?.priceInr ?? null;
  const w = line && aum !== null ? computeAumWhatIf(line, aum, currentPrice) : null;
  const dayLabel = (WHAT_IF_AUM_DAYS_OPTIONS.find((o) => o.value === whatIfDays) ?? WHAT_IF_AUM_DAYS_OPTIONS[1]).description;

  async function save() {
    if (!defaults || !entry) return;
    setSaving(true);
    try {
      const aumInputs = { ...(defaults.aumInputs ?? {}) };
      if (inputAum === null) delete aumInputs[entry.slug];
      else aumInputs[entry.slug] = inputAum;
      const res = await fetch("/api/stock-correlation-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...defaults, aumInputs, whatIfAumDays: whatIfDays }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Save failed");
      }
      await globalMutate((key) => typeof key === "string" && key.startsWith("/api/amc-stock-correlations"));
      toast.success("Saved as the default for everyone (shared with Stock Correlation)");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="AUM what-if" unit={`₹ per share · ${defaults.maDays}D-avg regression line`}>
      <div className="aa-controls">
        <label className="aa-field">
          Starting AUM
          <select className="aa-select" value={whatIfDays} onChange={(e) => setDays(Number(e.target.value))}>
            {WHAT_IF_AUM_DAYS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="aa-field">
          Input equity AAUM (₹ Cr)
          <input
            className="aa-input"
            inputMode="decimal"
            value={draft ?? (aum === null ? "" : formatLedgerInr(aum))}
            onFocus={(e) => {
              setDraft(aum === null ? "" : String(Math.round(aum)));
              const el = e.target;
              requestAnimationFrame(() => el.select());
            }}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft === null) return;
              const parsed = parseAumInput(draft);
              setDraft(null);
              if (parsed !== null && (aum === null || Math.abs(parsed - aum) >= 0.005)) setTyped((t) => ({ ...t, [entry.slug]: parsed }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setDraft(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </label>
        {inputAum !== null && (
          <button type="button" className="aa-btn aa-btn--ghost" onClick={() => setTyped((t) => ({ ...t, [entry.slug]: null }))}>
            Back to {dayLabel}
          </button>
        )}
        <button type="button" className="aa-btn" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save as default"}
        </button>
      </div>
      <table className="aa-kv">
        <tbody>
          <tr>
            <th scope="row">AUM used (₹ Cr)</th>
            <td>{formatLedgerInr(aum)}</td>
          </tr>
          <tr>
            <th scope="row">Target price</th>
            <td>{rupees(w?.targetPrice ?? null)}</td>
          </tr>
          <tr>
            <th scope="row">{priceIsLive ? "Live share price" : "Current price (last close)"}</th>
            <td>{rupees(currentPrice)}</td>
          </tr>
          <tr>
            <th scope="row">Upside</th>
            <td>
              <Pct change={w?.upsidePct ?? null} />
            </td>
          </tr>
        </tbody>
      </table>
      {w?.outOfRange && line && (
        <p className="aa-warn">
          Outside the fitted range (₹{formatLedgerInr(line.driverMin)}–₹{formatLedgerInr(line.driverMax)} Cr): the line is extrapolated here.
        </p>
      )}
    </Panel>
  );
}

// ── Live Predictor: today's live AUM through the same line, vs the live price ──
export function LivePredictorSection({
  entry,
  defaults,
  liveAumCr,
  cmpInr,
  cmpIsLive,
}: {
  entry: AmcStockCorrelationEntry | undefined;
  defaults: StockCorrelationDefaults | undefined;
  liveAumCr: number | null;
  cmpInr: number | null;
  cmpIsLive: boolean;
}) {
  const result = useSavedRegression(entry, defaults);
  const line = lineOf(result);
  if (!entry || !defaults) return null;
  // Today's live snapshot when we have it; else the latest stored day.
  const aum = liveAumCr ?? whatIfStartingAum(trimToLastContinuousRun(entry.aumHistory).map((d) => d.liveAumCr), 0);
  const w = line && aum !== null ? computeAumWhatIf(line, aum, cmpInr) : null;
  return (
    <Panel title="Live fair value" unit={`₹ per share · live AUM on the ${defaults.maDays}D-avg regression line`}>
      <table className="aa-kv">
        <tbody>
          <tr>
            <th scope="row">{liveAumCr != null ? "Live AUM (₹ Cr)" : "Latest stored AUM (₹ Cr)"}</th>
            <td>{formatLedgerInr(aum)}</td>
          </tr>
          <tr>
            <th scope="row">Implied price</th>
            <td>{rupees(w?.targetPrice ?? null)}</td>
          </tr>
          <tr>
            <th scope="row">{cmpIsLive ? "Live share price" : "Share price (last close)"}</th>
            <td>{rupees(cmpInr)}</td>
          </tr>
          <tr>
            <th scope="row">Gap (implied vs price)</th>
            <td>
              <Pct change={w?.upsidePct ?? null} />
            </td>
          </tr>
        </tbody>
      </table>
      {w?.outOfRange && line && (
        <p className="aa-warn">
          Live AUM is outside the fitted range (₹{formatLedgerInr(line.driverMin)}–₹{formatLedgerInr(line.driverMax)} Cr): the line is
          extrapolated here.
        </p>
      )}
    </Panel>
  );
}

// ── Ratio and Regression share one set of controls ─────────────────────
// Range and Moving avg re-fit both sections; AUM-only avg and Levels reach
// the Ratio section only (the regression engine always uses the raw price);
// Levels also swaps the Regression section to the daily % change model.
// Held in the AmcAnalytics shell so a choice survives switching sections
// and AMCs. Never saved; Extra Lag stays on the saved setting.
const RATIO_LADDER_LABELS: Record<(typeof RATIO_LADDER_SDS)[number], string> = {
  2: "+2 SD",
  1: "+1 SD",
  0: "Mean",
  [-1]: "−1 SD",
  [-2]: "−2 SD",
};

function rangeLabelOf(range: RangeOption): string {
  return RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range;
}

function savedMaInput(maDays: number): string {
  return maDays > 0 ? String(maDays) : "";
}

export interface FitControls {
  range: RangeOption;
  setRange: (r: RangeOption) => void;
  maDaysInput: string;
  setMaDaysInput: (v: string) => void;
  /** Debounced, clamped window that drives the computation. */
  maDays: number;
  aumOnlyAveraging: boolean;
  setAumOnlyAveraging: (v: boolean) => void;
  levelsCorrelation: boolean;
  setLevelsCorrelation: (v: boolean) => void;
  onSaved: boolean;
  savedLabel: string;
  /** When the saved view last changed (ISO), if it ever has. */
  savedAt: string | null;
  reset: () => void;
  saving: boolean;
  /** "Save as default": this view becomes every visitor's Ratio / Regression opening view. */
  save: () => Promise<void>;
}

// Ratio and Regression open on their own saved view (fit* settings), which
// starts out as the Stock Correlation default and only moves when someone
// saves here -- so a save never changes Stock Correlation, Fortnightly or
// the Predictors.
export function useFitControls(defaults: StockCorrelationDefaults | undefined): FitControls {
  // null = still on the saved setting.
  const [rangeChoice, setRangeChoice] = useState<RangeOption | null>(null);
  const [maInputChoice, setMaInputChoice] = useState<string | null>(null);
  const [aumOnlyChoice, setAumOnlyChoice] = useState<boolean | null>(null);
  const [levelsChoice, setLevelsChoice] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const savedRange = defaults?.fitRange ?? "3y";
  const savedMa = defaults?.fitMaDays ?? 1;
  const savedAumOnly = defaults?.fitAumOnlyAveraging ?? false;
  const savedLevels = defaults?.fitLevelsCorrelation ?? false;
  const maDaysInput = maInputChoice ?? (defaults ? savedMaInput(savedMa) : "");
  // Same clamp and ~300ms debounce as the Stock Correlation table -- but
  // only while someone is typing. On the saved value (first load, Back to
  // saved, after a save) it applies at once, so the charts never draw a
  // moment at MA 1 before the saved defaults arrive.
  const maDaysImmediate = Math.max(1, Math.min(250, parseInt(maDaysInput, 10) || 1));
  const [typedMaDays, setTypedMaDays] = useState(maDaysImmediate);
  useEffect(() => {
    const timer = setTimeout(() => setTypedMaDays(maDaysImmediate), 300);
    return () => clearTimeout(timer);
  }, [maDaysImmediate]);
  const maDays = maInputChoice === null ? maDaysImmediate : typedMaDays;
  const range = rangeChoice ?? savedRange;
  const aumOnlyAveraging = aumOnlyChoice ?? savedAumOnly;
  const levelsCorrelation = levelsChoice ?? savedLevels;
  const reset = () => {
    setRangeChoice(null);
    setMaInputChoice(null);
    setAumOnlyChoice(null);
    setLevelsChoice(null);
  };
  // Compared by value, so typing a setting back to the saved one counts as saved.
  const onSaved = range === savedRange && maDaysImmediate === savedMa && aumOnlyAveraging === savedAumOnly && levelsCorrelation === savedLevels;

  async function save() {
    if (!defaults) return;
    setSaving(true);
    try {
      const res = await fetch("/api/stock-correlation-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...defaults,
          fitRange: range,
          fitMaDays: maDaysImmediate,
          fitAumOnlyAveraging: aumOnlyAveraging,
          fitLevelsCorrelation: levelsCorrelation,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Save failed");
      }
      await globalMutate((key) => typeof key === "string" && key.startsWith("/api/amc-stock-correlations"));
      reset();
      toast.success("Saved as the Ratio / Regression default for everyone");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return {
    range,
    setRange: setRangeChoice,
    maDaysInput,
    setMaDaysInput: setMaInputChoice,
    maDays,
    aumOnlyAveraging,
    setAumOnlyAveraging: setAumOnlyChoice,
    levelsCorrelation,
    setLevelsCorrelation: setLevelsChoice,
    onSaved,
    savedLabel: `${RANGE_OPTIONS.find((o) => o.value === savedRange)?.label ?? savedRange} · ${savedMa > 1 ? `${savedMa}D` : "Latest"}`,
    savedAt: defaults?.fitSavedAt ?? null,
    reset,
    saving,
    save,
  };
}

function useFitResult(entry: AmcStockCorrelationEntry | undefined, defaults: StockCorrelationDefaults | undefined, c: FitControls) {
  const { maDays, range } = c;
  return useMemo(() => {
    if (!entry || !defaults) return null;
    return computeRegressionResult(entry.aumHistory, entry.stockPriceSeries, {
      maWindow: maDays,
      extraLagDays: defaults.extraLagDays as ExtraLagDays,
      range,
    });
  }, [entry, defaults, maDays, range]);
}

function ToggleBox({ id, label, title, checked, onChange }: { id: string; label: string; title: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} title={title} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5" />
      {label}
    </label>
  );
}

function savedAtText(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

// Ratio and Regression's shared Range / Moving avg / toggles and their
// "Save as default", pinned under the page top while scrolling so it stays
// beside whichever chart is in view.
function FitToolbar({ controls, showAumOnly, levelsTitle }: { controls: FitControls; showAumOnly: boolean; levelsTitle: string }) {
  // Pins just under the dashboard's own sticky page header, whose height
  // changes when it wraps on narrow screens (ResizeObserver reports it once
  // on observe, then on every change).
  const [top, setTop] = useState(0);
  useEffect(() => {
    const header = document.querySelector("header.sticky");
    if (!header) return;
    const ro = new ResizeObserver(() => setTop(header.getBoundingClientRect().height));
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="aa-fitbar" style={{ top }} role="toolbar" aria-label="Ratio and Regression settings">
      <div className="flex items-center gap-1" role="group" aria-label="Date range">
        {RANGE_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === controls.range}
            onClick={() => controls.setRange(o.value)}
            className={
              o.value === controls.range
                ? "rounded-md bg-foreground px-2 py-1 text-xs text-background"
                : "rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            }
          >
            {o.label}
          </button>
        ))}
      </div>
      <label htmlFor="aa-fit-ma" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Moving avg (days)
        <input
          id="aa-fit-ma"
          type="number"
          min={1}
          max={250}
          inputMode="numeric"
          value={controls.maDaysInput}
          onChange={(e) => controls.setMaDaysInput(e.target.value)}
          className="h-7 w-16 rounded-md border bg-background px-2 text-xs text-foreground"
        />
      </label>
      {showAumOnly && (
        <ToggleBox
          id="aa-aum-only-avg"
          label="AUM-only avg"
          title="Moving avg applies only to AUM; the ratio uses each day's raw share price instead of an averaged one"
          checked={controls.aumOnlyAveraging}
          onChange={controls.setAumOnlyAveraging}
        />
      )}
      <ToggleBox id="aa-fit-levels" label="Levels (no % chg)" title={levelsTitle} checked={controls.levelsCorrelation} onChange={controls.setLevelsCorrelation} />
      <span className="aa-fitbar-sep" aria-hidden />
      <button type="button" className="aa-btn" disabled={controls.onSaved || controls.saving} onClick={controls.save}>
        {controls.saving ? "Saving…" : "Save as default"}
      </button>
      {controls.onSaved ? (
        <span className="text-xs text-muted-foreground">
          On the saved settings ({controls.savedLabel}){controls.savedAt ? ` · saved ${savedAtText(controls.savedAt)}` : ""}
        </span>
      ) : (
        <button type="button" className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted" onClick={controls.reset}>
          Back to saved ({controls.savedLabel})
        </button>
      )}
    </div>
  );
}

// ── Ratio: the fit card (mean-ratio value + equation | fit grid), the
// Stock Correlation "AUM vs. Share Price" chart opening on its Ratio view,
// then the ratio ladder ──────────────────────────────────────────────
export function RatioSection({
  entry,
  defaults,
  controls,
  cmpInr,
  cmpIsLive,
}: {
  entry: AmcStockCorrelationEntry | undefined;
  defaults: StockCorrelationDefaults | undefined;
  controls: FitControls;
  cmpInr: number | null;
  cmpIsLive: boolean;
}) {
  const { maDays, range, aumOnlyAveraging, levelsCorrelation } = controls;
  const ladder = useMemo(
    () => (entry ? computeRatioLadder(entry.aumHistory, entry.stockPriceSeries, { maDays, range, aumOnlyAveraging }) : null),
    [entry, maDays, range, aumOnlyAveraging]
  );
  const extraLagDays = defaults?.extraLagDays ?? 0;
  const fit = useMemo(
    () =>
      entry ? computeFitCorrelation(entry.aumHistory, entry.stockPriceSeries, { maDays, range, aumOnlyAveraging, levelsCorrelation, extraLagDays }) : null,
    [entry, maDays, range, aumOnlyAveraging, levelsCorrelation, extraLagDays]
  );
  if (!entry || !defaults) return null;
  const lastPrice = entry.stockPriceSeries.at(-1)?.priceInr ?? null;
  const price = cmpInr ?? lastPrice;
  const priceIsLive = cmpInr !== null && cmpIsLive;
  return (
    <>
      <FitToolbar
        controls={controls}
        showAumOnly
        levelsTitle="Corr/R² use the two series' raw values directly instead of their day-over-day % change"
      />
      <div className="aa-reused">
        <AsideCard
          aside={
            <FitStatGrid r={fit?.r ?? null} r2={fit?.r2 ?? null} />
          }
        >
          <RatioFairValue
            ladder={ladder}
            price={price}
            priceIsLive={priceIsLive}
            maDays={maDays}
            aumOnlyAveraging={aumOnlyAveraging}
            rangeLabel={rangeLabelOf(range)}
            tradingSymbol={entry.tradingSymbol}
          />
        </AsideCard>
      </div>
      <div className="aa-reused" style={{ marginTop: 16 }}>
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <p className="text-sm font-medium text-foreground">AUM vs. Share Price</p>
          <p className="text-xs text-muted-foreground">
            Range, Moving avg, AUM-only avg and Levels come from the toolbar above and re-fit the Regression section too. Save as default stores them
            for everyone, for Ratio and Regression only; Stock Correlation and the Valuation Model keep their own settings.
          </p>
          <AumTrendChart
            data={entry.aumHistory}
            stockPriceSeries={entry.stockPriceSeries}
            stockLabel={entry.tradingSymbol}
            range={range}
            onRangeChange={controls.setRange}
            maDaysInput={controls.maDaysInput}
            onMaDaysInputChange={controls.setMaDaysInput}
            aumOnlyAveraging={aumOnlyAveraging}
            levelsCorrelation={levelsCorrelation}
            showReportedAum={false}
            initialView="ratio"
            hideRangeControls
          />
        </div>
      </div>
      <RatioLadderPanel ladder={ladder} maDays={maDays} aumOnlyAveraging={aumOnlyAveraging} cmpInr={price} cmpIsLive={priceIsLive} />
    </>
  );
}

// Left half of the Ratio fit card: price vs the mean ratio × today's AUM MA,
// written out as the equation it comes from.
function RatioFairValue({
  ladder,
  price,
  priceIsLive,
  maDays,
  aumOnlyAveraging,
  rangeLabel,
  tradingSymbol,
}: {
  ladder: RatioLadder | null;
  price: number | null;
  priceIsLive: boolean;
  maDays: number;
  aumOnlyAveraging: boolean;
  rangeLabel: string;
  tradingSymbol: string;
}) {
  const aumLabel = maDays > 1 ? `AUM MA${maDays}` : "AUM";
  const priceLabel = aumOnlyAveraging || maDays <= 1 ? "Price" : `Price MA${maDays}`;
  const fair = ladder ? ladder.meanRatio * ladder.aumCr : null;
  const gap = fair && price !== null ? (price - fair) / fair : null;
  return (
    <>
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Price vs Ratio Fair Value (mean)</p>
      {!ladder || fair === null ? (
        <p className="text-sm text-muted-foreground">Not enough history in this range to compute a stable ratio distribution.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-2xl font-semibold tabular-nums">{price === null ? "—" : formatPriceInr(price)}</span>
            <span className="text-xs text-muted-foreground">vs mean-ratio value</span>
            <span className="font-mono text-2xl font-semibold tabular-nums text-blue-600 dark:text-blue-400">{formatPriceInr(fair)}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Price is{" "}
            <span className={gap !== null && gap < 0 ? "font-semibold text-emerald-600 dark:text-emerald-400" : "font-semibold text-red-600 dark:text-red-400"}>
              {gap === null ? "—" : `${formatPct(Math.abs(gap))} ${gap < 0 ? "below" : "above"}`}
            </span>{" "}
            the mean-ratio value. Today&apos;s ratio {ladder.currentRatio.toFixed(5)} is{" "}
            {ladder.zScore === null ? "—" : `${ladder.zScore >= 0 ? "+" : "−"}${Math.abs(ladder.zScore).toFixed(2)}`} SD from its {rangeLabel} mean (−1 SD{" "}
            {(ladder.meanRatio - ladder.stdDev).toFixed(5)} · +1 SD {(ladder.meanRatio + ladder.stdDev).toFixed(5)}).
          </p>
          <div className="overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-xs whitespace-nowrap">
            {priceLabel} = {ladder.meanRatio.toFixed(6)} × {aumLabel} = {ladder.meanRatio.toFixed(6)} × ₹{formatLedgerInr(ladder.aumCr)} Cr = {formatPriceInr(fair)}
          </div>
          <div className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            n {ladder.n} sessions · mean of {priceLabel} ÷ {aumLabel} from {formatShortDateWithYear(ladder.from)} · {tradingSymbol}.NS{" "}
            {priceIsLive ? "live price" : "last close"}
          </div>
        </>
      )}
    </>
  );
}

// ── Regression: the Regression tab's deep-dive (its ratio panel moved to
// the Ratio section), with the fit grid beside the fair value card ──────
export function RegressionSection({
  entry,
  defaults,
  controls,
  cmpInr,
  cmpIsLive,
}: {
  entry: AmcStockCorrelationEntry | undefined;
  defaults: StockCorrelationDefaults | undefined;
  controls: FitControls;
  cmpInr: number | null;
  cmpIsLive: boolean;
}) {
  const result = useFitResult(entry, defaults, controls);
  // Always the levels line, even when Levels is off and the cards above
  // show the daily % change model: only it has a model price per session.
  const modelRatio = useMemo(() => computeModelRatioLadder(result, cmpInr), [result, cmpInr]);
  const { maDays, range, levelsCorrelation } = controls;
  const pctResult = useMemo(() => {
    if (!entry || !defaults || levelsCorrelation) return null;
    return computePctChangeRegression(entry.aumHistory, entry.stockPriceSeries, {
      maWindow: maDays,
      extraLagDays: defaults.extraLagDays as ExtraLagDays,
      range,
    });
  }, [entry, defaults, maDays, range, levelsCorrelation]);
  if (!entry || !defaults) return null;
  const lag = defaults.extraLagDays;
  return (
    <>
      <FitToolbar
        controls={controls}
        showAumOnly={false}
        levelsTitle="On: Price regressed on the AUM MA level. Off: the daily % change in the raw share price regressed on the daily % change in the AUM MA, with the target at live AUM vs its 45-day average"
      />
      <div className="aa-reused">
        {levelsCorrelation ? (
          <RegressionDeepDive
            result={result}
            tradingSymbol={entry.tradingSymbol}
            maWindow={maDays}
            extraLagDays={lag}
            showScatter
            showRatioPanel={false}
            afterActualVsModel={<ModelRatioPanel ladder={modelRatio} cmpIsLive={cmpInr !== null && cmpIsLive} maDays={maDays} />}
            aside={
              result ? (
                <FitStatGrid r={result.pearsonR} r2={result.r2} />
              ) : undefined
            }
          />
        ) : (
          <PctChangeRegressionView
            result={pctResult}
            tradingSymbol={entry.tradingSymbol}
            maWindow={maDays}
            extraLagDays={lag}
            afterActualVsModel={<ModelRatioPanel ladder={modelRatio} cmpIsLive={cmpInr !== null && cmpIsLive} maDays={maDays} />}
            aside={
              pctResult ? (
                <FitStatGrid r={pctResult.pearsonR} r2={pctResult.r2} />
              ) : undefined
            }
          />
        )}
      </div>
    </>
  );
}

// Close ÷ the levels best-fit line, per session, with its mean and ±SD over
// the fit window, then the price at each level (today's model value × the
// ratio). Shown on the Regression sub-tab between Actual vs Model and the
// scatter, whichever model the cards above use.
function ModelRatioPanel({ ladder, cmpIsLive, maDays }: { ladder: ModelRatioLadder | null; cmpIsLive: boolean; maDays: number }) {
  if (!ladder) return null;
  const aumLabel = maDays > 1 ? `AUM MA${maDays}` : "AUM";
  const z = ladder.zScore;
  return (
    <>
      <div className="space-y-1 rounded-lg border bg-card p-4">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold tracking-wide uppercase">Share Price ÷ Model</span> · each session&apos;s close over the levels best-fit line (
          {aumLabel}), with the mean and ±1 / ±2 SD of the fit window
        </p>
        <p className="text-xs text-muted-foreground">
          Above 1.00 the close was above the line, below 1.00 under it. Today {ladder.currentRatio.toFixed(4)}
          {z === null ? "" : ` (${z >= 0 ? "+" : "−"}${Math.abs(z).toFixed(2)} SD)`}. The line is fitted on these same sessions, so the mean sits near
          1.00; the SD lines show how far the price has typically strayed from it, not the odds of reaching a level.
        </p>
        <ModelRatioChart ladder={ladder} />
      </div>
      <section className="pl-panel vm" aria-label="Model ratio analysis">
        <div className="pl-band">
          Model Ratio Analysis{" "}
          <span className="pl-band-unit">
            Close ÷ Model · ₹ per share · today&apos;s model value {rupees(ladder.modelValue)} · vs {cmpIsLive ? "live price" : "last close"}{" "}
            {rupees(ladder.currentPrice)}
          </span>
        </div>
        <div className="vm-grid">
          <table className="vm-t">
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Ratio</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              {RATIO_LADDER_SDS.map((k) => {
                const price = modelRatioPrice(ladder, k);
                return (
                  <tr key={k} className={k === 0 ? "vm-avg" : undefined}>
                    <th scope="row">
                      <b>{RATIO_LADDER_LABELS[k]}</b>
                    </th>
                    <td className="vm-c">
                      <span className="vm-p">{(ladder.meanRatio + k * ladder.stdDev).toFixed(4)}</span>
                    </td>
                    <PriceCell price={price} upside={ladder.currentPrice ? price / ladder.currentPrice - 1 : null} />
                  </tr>
                );
              })}
            </tbody>
          </table>
          <table className="aa-kv">
            <tbody>
              <tr>
                <th scope="row">Today&apos;s ratio</th>
                <td>{ladder.currentRatio.toFixed(4)}</td>
              </tr>
              <tr>
                <th scope="row">Z-score</th>
                <td>{z === null ? "—" : `${z >= 0 ? "+" : "−"}${Math.abs(z).toFixed(2)}`}</td>
              </tr>
              <tr>
                <th scope="row">Today&apos;s model value</th>
                <td>{rupees(ladder.modelValue)}</td>
              </tr>
              <tr>
                <th scope="row">Sessions</th>
                <td>
                  {ladder.n} · {ladder.from} → {ladder.to}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// Price at each Price ÷ AUM level × today's AUM MA. Same numbers as the
// chart's Ratio view bands; on the saved settings the Mean row is the
// Valuation Model's Ratio Base.
function RatioLadderPanel({
  ladder,
  maDays,
  aumOnlyAveraging,
  cmpInr,
  cmpIsLive,
}: {
  ladder: RatioLadder | null;
  maDays: number;
  aumOnlyAveraging: boolean;
  cmpInr: number | null;
  cmpIsLive: boolean;
}) {
  const maLabel = maDays > 1 ? `AUM MA${maDays}` : "AUM";
  const priceLabel = aumOnlyAveraging || maDays <= 1 ? "Price" : `Price MA${maDays}`;
  return (
    <section className="pl-panel vm" aria-label="Ratio analysis" style={{ marginTop: 16 }}>
      <div className="pl-band">
        Ratio Analysis{" "}
        <span className="pl-band-unit">
          {priceLabel} ÷ {maLabel} · ₹ per share · vs {cmpIsLive ? "live price" : "last close"} {rupees(cmpInr)}
        </span>
      </div>
      {!ladder ? (
        <p className="aa-note" style={{ padding: 12 }}>
          Not enough history in this range to compute a stable ratio distribution.
        </p>
      ) : (
        <div className="vm-grid">
          <table className="vm-t">
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Ratio</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              {RATIO_LADDER_SDS.map((k) => {
                const ratio = ladder.meanRatio + k * ladder.stdDev;
                const price = ratio * ladder.aumCr;
                return (
                  <tr key={k} className={k === 0 ? "vm-avg" : undefined}>
                    <th scope="row">
                      <b>{RATIO_LADDER_LABELS[k]}</b>
                    </th>
                    <td className="vm-c">
                      <span className="vm-p">{ratio.toFixed(5)}</span>
                    </td>
                    <PriceCell price={price} upside={cmpInr ? price / cmpInr - 1 : null} />
                  </tr>
                );
              })}
            </tbody>
          </table>
          <table className="aa-kv">
            <tbody>
              <tr>
                <th scope="row">Current ratio</th>
                <td>{ladder.currentRatio.toFixed(5)}</td>
              </tr>
              <tr>
                <th scope="row">Z-score</th>
                <td>{ladder.zScore === null ? "—" : `${ladder.zScore >= 0 ? "+" : ""}${ladder.zScore.toFixed(2)}`}</td>
              </tr>
              <tr>
                <th scope="row">Today&apos;s {maLabel}</th>
                <td>₹{formatLedgerInr(ladder.aumCr)} Cr</td>
              </tr>
              <tr>
                <th scope="row">Sessions</th>
                <td>
                  {ladder.n} · {ladder.from} → {ladder.to}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Valuation Model: band charts, then the 4-method Target Price table ───
const METHOD_ROWS: { key: ValuationMethodKey; name: string; how: (t: TargetPriceTable, s: ValuationSettings) => string }[] = [
  {
    key: "ratio",
    name: "Ratio",
    how: (t, s) =>
      `Price ÷ ${dayText(s.ratioHistoryDays)} equity AUM (${rangeText(s.ratioRange)}${t.ratioFit ? `, ${t.ratioFit.sessions} sessions` : ""}): −1 SD / Mean / +1 SD × today's ${dayText(s.ratioTodayDays)} AUM (₹${formatLedgerInr(t.ratioAumCr)} Cr)`,
  },
  {
    key: "bestFit",
    name: "Best fit line",
    how: (t, s) =>
      `Line fitted on ${rangeText(s.bestFitRange)} with ${dayText(s.bestFitMaDays)} AUM${t.bestFitLine ? ` (R² ${t.bestFitLine.r2.toFixed(2)}, ${t.bestFitLine.sessions} sessions)` : ""}, read at ${dayText(s.bestFitAumDays)} AUM (₹${formatLedgerInr(t.bestFitAumCr)} Cr) −${s.bestFitAumPct}% / as is / +${s.bestFitAumPct}%`,
  },
  { key: "pe", name: "PE", how: () => "FY28E PAT × target PE ÷ shares, discounted 2 periods (FY27, FY26 rates)" },
  { key: "mcapSales", name: "Mcap / Sales", how: () => "FY28E revenue × Mcap / Sales ÷ shares, discounted 2 periods" },
];

interface ValuationSettings {
  ratioRange: RangeOption;
  ratioHistoryDays: number;
  ratioTodayDays: number;
  bestFitRange: RangeOption;
  bestFitMaDays: number;
  bestFitAumDays: number;
  bestFitAumPct: number;
  /** Each AMC's typed AUM (₹ Cr) for the Custom choice. */
  ratioCustomAum: Record<string, number>;
  bestFitCustomAum: Record<string, number>;
  /** The Average's weight (%) per method, shared like the rest. */
  weights: ValuationWeights;
}

function dayText(days: number): string {
  return days === CUSTOM_AUM_DAYS ? "custom" : days === 0 ? "live" : `${days}D-avg`;
}

function rangeText(range: RangeOption): string {
  return RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range;
}

function WeightSelect({ value, label, onChange }: { value: number; label: string; onChange: (v: number) => void }) {
  return (
    <select className="vm-sel vm-w" aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {VALUATION_WEIGHT_OPTIONS.map((o) => (
        <option key={o} value={o}>
          {o}%
        </option>
      ))}
    </select>
  );
}

// The weights' total: green at 100%, red (and scaled to 100%) otherwise.
function WeightTotal({ weights }: { weights: ValuationWeights }) {
  const total = weights.ratio + weights.bestFit + weights.pe + weights.mcapSales;
  return (
    <span className={`vm-total vm-total--${total === 100 ? "ok" : "off"}`} title={total === 100 ? undefined : "Scaled to 100%"}>
      {total}%
    </span>
  );
}

// What the Base Average was built from, after rescaling, e.g. "Ratio 35% · PE 50%".
function weightMixText(t: TargetPriceTable): string {
  const parts = METHOD_ROWS.flatMap((r) => {
    const share = t.averageShares[r.key];
    return share === null ? [] : [`${r.name} ${(Math.round(share * 1000) / 10).toString()}%`];
  });
  return parts.length ? parts.join(" · ") : "No method has a value and a weight";
}

function PriceCell({ price, upside }: { price: number | null; upside: number | null }) {
  return (
    <td className="vm-c">
      <span className="vm-p">{price === null ? "—" : formatLedgerInr(price)}</span>
      {price !== null && <Pct change={upside} />}
    </td>
  );
}

// A number box that saves on blur/Enter; blank saves null. `scale` maps the
// shown value to the stored one (rates: shown in %, stored as a fraction).
export function SavedNumberInput({
  value,
  onSave,
  ariaLabel,
  decimals = 2,
  scale = 1,
  placeholder,
  muted,
  grouped,
}: {
  value: number | null;
  onSave: (v: number | null) => Promise<void>;
  ariaLabel: string;
  decimals?: number;
  scale?: number;
  placeholder?: string;
  muted?: boolean;
  /** Show Indian digit grouping (14,400) until the cell is clicked. */
  grouped?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value === null ? "" : String(Number((value * scale).toFixed(decimals)));
  const display = grouped && value !== null ? Number(shown).toLocaleString("en-IN", { maximumFractionDigits: decimals }) : shown;
  const commit = async () => {
    if (draft === null) return;
    const text = draft.replace(/,/g, "").trim();
    setDraft(null);
    const next = text === "" ? null : Number(text);
    if (next !== null && !Number.isFinite(next)) {
      toast.error(`${ariaLabel}: not a number`);
      return;
    }
    const stored = next === null ? null : next / scale;
    if (stored === value || (stored !== null && value !== null && Math.abs(stored - value) < 1e-9)) return;
    try {
      await onSave(stored);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    }
  };
  return (
    <input
      className={`vm-in${muted && draft === null ? " is-band" : ""}`}
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder ?? "—"}
      value={draft ?? display}
      onFocus={() => setDraft(shown)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

// ── Valuation Model: the Bear / Base / Bull valuation,
// laid out like the user's reference "Valuation · FY28E" table: one for
// PE (FY28E PAT) and one for Mcap / Sales (FY28E revenue). Same maths as
// the Fortnightly card (computeValuationBlock), same inputs (the latest
// Fortnightly snapshot), so the three places always agree.
type ScenarioKey = (typeof SCENARIO_KEYS)[number];
const SCENARIO_LABEL: Record<ScenarioKey, string> = { bear: "Bear", base: "Base", bull: "Bull" };

function inr0(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : formatLedgerInr(v);
}

function ScenarioRow({ label, values, className, fmt = inr0 }: { label: string; values: Record<ScenarioKey, number | null>; className?: string; fmt?: (v: number | null) => string }) {
  return (
    <tr className={className}>
      <th scope="row">{label}</th>
      {SCENARIO_KEYS.map((k) => (
        <td key={k}>{fmt(values[k])}</td>
      ))}
    </tr>
  );
}

/** The band between the FY28 → FY27 → Current steps. One table, not three,
 *  so every step shares the header's columns. */
function GapRow() {
  return (
    <tr className="vs-gap" aria-hidden="true">
      <td colSpan={4} />
    </tr>
  );
}

function UpsideRow({ values }: { values: Record<ScenarioKey, number | null> }) {
  return (
    <tr className="vs-up">
      <th scope="row">Upside</th>
      {SCENARIO_KEYS.map((k) => (
        <td key={k}>
          <Pct change={values[k]} />
        </td>
      ))}
    </tr>
  );
}

/** One value shown across all three columns, editable in Base (the reference layout). */
function SharedInputRow({
  label,
  value,
  editable,
  onSave,
  decimals,
  scale = 1,
  fmt,
  className,
}: {
  label: string;
  value: number | null;
  editable: boolean;
  onSave: (v: number | null) => Promise<void>;
  decimals: number;
  scale?: number;
  fmt: (v: number | null) => string;
  className?: string;
}) {
  return (
    <tr className={className}>
      <th scope="row">{label}</th>
      <td>{fmt(value)}</td>
      <td className={editable ? "vs-in" : undefined}>
        {editable ? <SavedNumberInput value={value} onSave={onSave} ariaLabel={label} decimals={decimals} scale={scale} /> : fmt(value)}
      </td>
      <td>{fmt(value)}</td>
    </tr>
  );
}

// The PE and Mcap / Sales tables side by side: the caption and each row
// are held to the taller of the pair, so a label that wraps on one side
// never pushes the other side's rows out of line. Skipped once the two
// stack (narrow screens).
function AlignedScenarioGrid({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const align = () => {
      const blocks = [...grid.querySelectorAll<HTMLElement>(".vs-block")];
      const rows = blocks.map((b) => [...b.querySelectorAll<HTMLElement>(".vs-cap, tr")]);
      rows.flat().forEach((r) => (r.style.height = ""));
      if (blocks.length !== 2 || rows[0].length !== rows[1].length) return;
      if (Math.abs(blocks[0].offsetTop - blocks[1].offsetTop) > 1) return;
      rows[0].forEach((left, i) => {
        const right = rows[1][i];
        const h = Math.max(left.getBoundingClientRect().height, right.getBoundingClientRect().height);
        left.style.height = right.style.height = `${h}px`;
      });
    };
    align();
    let lastWidth = grid.clientWidth;
    const observer = new ResizeObserver(() => {
      if (grid.clientWidth === lastWidth) return;
      lastWidth = grid.clientWidth;
      align();
    });
    observer.observe(grid);
    return () => observer.disconnect();
  });
  return (
    <div className="vs-grid" ref={ref}>
      {children}
    </div>
  );
}

function ScenarioValuationTable({
  kind,
  manual: m,
  cmpInr,
  editable,
  saveField,
  multiples,
  band,
}: {
  kind: "pe" | "mcapSales";
  manual: AmcAnalyticsManual;
  cmpInr: number | null;
  editable: boolean;
  saveField: (field: AmcAnalyticsField, value: number | null) => Promise<void>;
  /** Mcap / Sales only: the multiple each scenario uses (typed, else the chart band). */
  multiples?: Record<ScenarioKey, number | null>;
  band?: { mean: number; sd: number } | null;
}) {
  const isPe = kind === "pe";
  const earnings = isPe ? m.patFy28eCr : m.revenueFy28eCr;
  const v = computeValuationBlock(
    isPe
      ? m
      : { ...m, patFy28eCr: m.revenueFy28eCr, targetPeBear: multiples?.bear ?? null, targetPeBase: multiples?.base ?? null, targetPeBull: multiples?.bull ?? null },
    cmpInr
  );
  const perShare = earnings !== null && m.noOfSharesCr ? earnings / m.noOfSharesCr : null;
  const multipleFields = isPe
    ? (["targetPeBear", "targetPeBase", "targetPeBull"] as const)
    : (["targetMcapSalesBear", "targetMcapSalesBase", "targetMcapSalesBull"] as const);
  const pctFmt = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
  const sharesFmt = (x: number | null) => (x === null ? "—" : x.toLocaleString("en-IN", { maximumFractionDigits: 2 }));
  const perShareFmt = (x: number | null) => (x === null ? "—" : x.toLocaleString("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  return (
    <div className="vs-block">
      <p className="vs-cap">
        <b>{isPe ? "PE method" : "Mcap / Sales method"}</b> {isPe ? "FY28E PAT × target PE" : "FY28E revenue × Mcap / Sales multiple"} ÷ shares, discounted to today
      </p>
      <table className="vs-t">
        <thead>
          <tr>
            <th scope="col">CMP {cmpInr === null ? "—" : `₹${inr0(cmpInr)}`}</th>
            {SCENARIO_KEYS.map((k) => (
              <th key={k} scope="col" className={`vs-${k}`}>
                {SCENARIO_LABEL[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <SharedInputRow
            label={isPe ? "PAT FY28E (₹ Cr)" : "Revenue FY28E (₹ Cr)"}
            value={earnings}
            editable={editable}
            onSave={(x) => saveField(isPe ? "patFy28eCr" : "revenueFy28eCr", x)}
            decimals={0}
            fmt={inr0}
          />
          <SharedInputRow label="Shares (Cr)" value={m.noOfSharesCr} editable={editable} onSave={(x) => saveField("noOfSharesCr", x)} decimals={2} fmt={sharesFmt} />
          <ScenarioRow label={isPe ? "EPS FY28E (₹)" : "Revenue / share FY28E (₹)"} values={{ bear: perShare, base: perShare, bull: perShare }} fmt={perShareFmt} />
          <tr className="vs-mult">
            <th scope="row">{isPe ? "PE (x)" : "Mcap / Sales (x)"}</th>
            {multipleFields.map((f, i) => {
              const bandValue = !isPe && band ? band.mean + (i - 1) * band.sd : null;
              const value = m[f];
              return (
                <td key={f} className={editable ? "vs-in" : undefined}>
                  {editable ? (
                    <SavedNumberInput
                      value={value}
                      onSave={(x) => saveField(f, x)}
                      ariaLabel={`${isPe ? "PE" : "Mcap / Sales"} ${SCENARIO_KEYS[i]}`}
                      decimals={isPe ? 2 : 1}
                      placeholder={bandValue === null ? "—" : bandValue.toFixed(1)}
                      muted={!isPe && value === null}
                    />
                  ) : (
                    (value ?? bandValue)?.toFixed(isPe ? 0 : 1) ?? "—"
                  )}
                </td>
              );
            })}
          </tr>
          <ScenarioRow label="Price Target FY28" values={v.fy28TargetPriceInr} className="vs-strong" />
          <UpsideRow values={v.fy28UpsidePct} />
          <GapRow />
          <SharedInputRow
            label="Discount % (FY27)"
            value={m.discountRateFy27Pct}
            editable={editable}
            onSave={(x) => saveField("discountRateFy27Pct", x)}
            decimals={2}
            scale={100}
            fmt={pctFmt}
          />
          <ScenarioRow label="Target Price FY27" values={v.fy27DiscountedPriceInr} className="vs-strong" />
          <GapRow />
          <SharedInputRow
            label="Discount % (FY26)"
            value={m.discountRateFy26Pct}
            editable={editable}
            onSave={(x) => saveField("discountRateFy26Pct", x)}
            decimals={2}
            scale={100}
            fmt={pctFmt}
          />
          <ScenarioRow label="Target Price Current" values={v.fy26DiscountedPriceInr} className="vs-strong" />
          <UpsideRow values={v.fy26UpsidePct} />
        </tbody>
      </table>
    </div>
  );
}

export function ValuationModelSection({
  slug,
  entry,
  defaults,
  inputs,
  amcOptions,
  onSlugChange,
  cmpInr,
  cmpIsLive,
}: {
  slug: string;
  entry: AmcStockCorrelationEntry | undefined;
  defaults: StockCorrelationDefaults | undefined;
  /** The AMC's stored inputs (the same figures the Fortnightly tab shows). */
  inputs: AmcAnalyticsInputs | undefined;
  amcOptions: { slug: string; label: string }[];
  onSlugChange: (slug: string) => void;
  /** Today's live price when there is one, else the snapshot's close (see the shell). */
  cmpInr: number | null;
  cmpIsLive: boolean;
}) {
  const { data: valuation } = useAmcValuation(slug);
  const [local, setLocal] = useState<Partial<ValuationSettings>>({});
  const [saving, setSaving] = useState(false);
  const settings: ValuationSettings = {
    ratioRange: local.ratioRange ?? defaults?.valuationRatioRange ?? "3y",
    ratioHistoryDays: local.ratioHistoryDays ?? defaults?.valuationRatioHistoryDays ?? DEFAULT_VALUATION_RATIO_DAYS,
    ratioTodayDays: local.ratioTodayDays ?? defaults?.valuationRatioDays ?? DEFAULT_VALUATION_RATIO_DAYS,
    bestFitRange: local.bestFitRange ?? defaults?.bestFitRange ?? "3y",
    bestFitMaDays: local.bestFitMaDays ?? defaults?.bestFitMaDays ?? DEFAULT_VALUATION_RATIO_DAYS,
    bestFitAumDays: local.bestFitAumDays ?? defaults?.bestFitAumDays ?? DEFAULT_BEST_FIT_AUM_DAYS,
    bestFitAumPct: local.bestFitAumPct ?? defaults?.bestFitAumPct ?? DEFAULT_BEST_FIT_AUM_PCT,
    ratioCustomAum: { ...defaults?.valuationRatioCustomAum, ...local.ratioCustomAum },
    bestFitCustomAum: { ...defaults?.bestFitCustomAum, ...local.bestFitCustomAum },
    weights: local.weights ?? defaults?.valuationWeights ?? DEFAULT_VALUATION_WEIGHTS,
  };
  const ratioCustomCr = settings.ratioCustomAum[slug] ?? null;
  const bestFitCustomCr = settings.bestFitCustomAum[slug] ?? null;
  const sheetForSlug = inputs && inputs.slug === slug ? inputs : undefined;

  const table = useMemo(() => {
    if (!entry || !defaults || !sheetForSlug) return null;
    return computeTargetPrices({
      aumHistory: entry.aumHistory,
      stockPriceSeries: entry.stockPriceSeries,
      ratioRange: settings.ratioRange,
      ratioHistoryDays: settings.ratioHistoryDays,
      ratioTodayDays: settings.ratioTodayDays,
      ratioCustomAumCr: ratioCustomCr,
      bestFitCustomAumCr: bestFitCustomCr,
      bestFitRange: settings.bestFitRange,
      bestFitMaDays: settings.bestFitMaDays,
      extraLagDays: defaults.extraLagDays,
      bestFitAumDays: settings.bestFitAumDays,
      bestFitAumPct: settings.bestFitAumPct,
      manual: sheetForSlug.manual,
      mcapSalesSeries: withLiveValuationPoint(valuation?.points ?? [], entry.stockPriceSeries.at(-1), entry.stockPriceSeries).flatMap((p) => (p.mcapToSales === null ? [] : [{ date: p.date, value: p.mcapToSales }])),
      cmpInr,
      weights: settings.weights,
    });
  }, [
    entry,
    defaults,
    sheetForSlug,
    valuation,
    settings.ratioRange,
    settings.ratioHistoryDays,
    settings.ratioTodayDays,
    settings.bestFitRange,
    settings.bestFitMaDays,
    settings.bestFitAumDays,
    settings.bestFitAumPct,
    ratioCustomCr,
    bestFitCustomCr,
    cmpInr,
    settings.weights,
  ]);

  // Picking Custom starts this AMC's box at the AUM the previous choice gave.
  const pickRatioDays = (v: number) =>
    setLocal((s) => ({
      ...s,
      ratioTodayDays: v,
      ...(v === CUSTOM_AUM_DAYS && ratioCustomCr === null && table?.ratioAumCr != null
        ? { ratioCustomAum: { ...s.ratioCustomAum, [slug]: Math.round(table.ratioAumCr) } }
        : {}),
    }));
  const pickBestFitDays = (v: number) =>
    setLocal((s) => ({
      ...s,
      bestFitAumDays: v,
      ...(v === CUSTOM_AUM_DAYS && bestFitCustomCr === null && table?.bestFitAumCr != null
        ? { bestFitCustomAum: { ...s.bestFitCustomAum, [slug]: Math.round(table.bestFitAumCr) } }
        : {}),
    }));
  // The figures saved with "Save as default": every AMC's typed one, plus
  // the one on screen for this AMC when it's on Custom (even if untouched).
  const customToSave = (map: Record<string, number>, days: number, shown: number | null | undefined) =>
    days === CUSTOM_AUM_DAYS && map[slug] === undefined && shown != null ? { ...map, [slug]: Math.round(shown) } : map;

  async function saveField(field: AmcAnalyticsField, value: number | null) {
    if (!sheetForSlug) return;
    await saveAmcInput(sheetForSlug.amcId, field, value);
  }

  async function saveSettings() {
    if (!defaults) return;
    setSaving(true);
    try {
      const res = await fetch("/api/stock-correlation-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...defaults,
          valuationRatioDays: settings.ratioTodayDays,
          bestFitAumDays: settings.bestFitAumDays,
          bestFitAumPct: settings.bestFitAumPct,
          valuationRatioRange: settings.ratioRange,
          valuationRatioHistoryDays: settings.ratioHistoryDays,
          bestFitRange: settings.bestFitRange,
          bestFitMaDays: settings.bestFitMaDays,
          valuationRatioCustomAum: customToSave(settings.ratioCustomAum, settings.ratioTodayDays, table?.ratioAumCr),
          bestFitCustomAum: customToSave(settings.bestFitCustomAum, settings.bestFitAumDays, table?.bestFitAumCr),
          valuationWeights: settings.weights,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Save failed");
      }
      await globalMutate((key) => typeof key === "string" && key.startsWith("/api/amc-stock-correlations"));
      setLocal({});
      toast.success("Saved as the default for everyone");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const m = sheetForSlug?.manual;
  const editable = !!sheetForSlug;
  const band = table?.mcapSalesBand ?? null;

  return (
    <>
      <section className="pl-panel vm" aria-label="Valuation FY28E" style={{ marginBottom: 16 }}>
        <div className="pl-band">
          Valuation · FY28E{" "}
          <span className="pl-band-unit">
            Bear / Base / Bull · income ₹ Cr · targets ₹ per share · shared with the Fortnightly AMC Update tab
          </span>
        </div>
        {!m ? (
          <p className="aa-note" style={{ padding: 12 }}>
            Loading the valuation inputs…
          </p>
        ) : (
          <AlignedScenarioGrid>
            <ScenarioValuationTable kind="pe" manual={m} cmpInr={cmpInr} editable={editable} saveField={saveField} />
            <ScenarioValuationTable
              kind="mcapSales"
              manual={m}
              cmpInr={cmpInr}
              editable={editable}
              saveField={saveField}
              multiples={table?.mcapSalesMultiples}
              band={band}
            />
          </AlignedScenarioGrid>
        )}
        <p className="aa-note" style={{ padding: "0 12px 12px" }}>
          Blue cells save straight away, to the same stored figures the Fortnightly AMC Update tab shows. Grey Mcap / Sales multiples are the
          chart&apos;s 3Y −1 SD / Mean / +1 SD; type to override, clear to go back to the band. Target Price Current is the PE / Mcap / Sales row
          of the Target Price table below. Upsides use today&apos;s price (the last close outside market hours).
        </p>
      </section>

      <div className="aa-reused">
        <ValuationBandCharts slug={slug} amcOptions={amcOptions} onSlugChange={onSlugChange} showUpload={false} priceSeries={entry?.stockPriceSeries} />
      </div>

      <section className="pl-panel vm" aria-label="Target price" style={{ marginTop: 16 }}>
        <div className="pl-band">
          Target Price{" "}
          <span className="pl-band-unit">
            ₹ per share · vs {cmpIsLive ? "live price" : "last close"}{" "}
            {cmpInr != null ? `₹${cmpInr.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
          </span>
        </div>
        {!table || !m ? (
          <p className="aa-note" style={{ padding: 12 }}>
            Loading the valuation inputs…
          </p>
        ) : (
          <div className="vm-grid">
            <table className="vm-t">
              <thead>
                <tr>
                  <th scope="col">Method</th>
                  <th scope="col" className="vm-wcol">
                    Weight
                  </th>
                  <th scope="col">Bear</th>
                  <th scope="col">Base</th>
                  <th scope="col">Bull</th>
                </tr>
              </thead>
              <tbody>
                {METHOD_ROWS.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">
                      <b>{row.name}</b>
                      <small>{row.how(table, settings)}</small>
                    </th>
                    <td className="vm-wcol">
                      <WeightSelect
                        value={settings.weights[row.key]}
                        label={`${row.name} weight`}
                        onChange={(v) => setLocal((s) => ({ ...s, weights: { ...settings.weights, [row.key]: v } }))}
                      />
                    </td>
                    {SCENARIO_KEYS.map((k) => (
                      <PriceCell key={k} price={table.methods[row.key][k]} upside={table.upside[row.key][k]} />
                    ))}
                  </tr>
                ))}
                <tr className="vm-avg">
                  <th scope="row">
                    <b>Weighted average</b>
                    <small>{weightMixText(table)}</small>
                  </th>
                  <td className="vm-wcol">
                    <WeightTotal weights={settings.weights} />
                  </td>
                  {SCENARIO_KEYS.map((k) => (
                    <PriceCell key={k} price={table.average[k]} upside={table.upside.average[k]} />
                  ))}
                </tr>
              </tbody>
            </table>

            <table className="vm-t vm-inputs">
              <colgroup>
                <col className="vm-col-label" />
                <col />
                <col />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" colSpan={4}>
                    Settings
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="vm-grp">
                  <td colSpan={4}>Ratio</td>
                </tr>
                <tr>
                  <th scope="row">
                    Period <small>window for the mean and SD</small>
                  </th>
                  <td colSpan={3}>
                    <RangeButtons value={settings.ratioRange} onChange={(v) => setLocal((s) => ({ ...s, ratioRange: v }))} label="Ratio period" />
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    History AUM avg (days) <small>the mean and SD are built on</small>
                  </th>
                  <td colSpan={3}>
                    <AvgDaysInput
                      value={settings.ratioHistoryDays}
                      onChange={(v) => setLocal((s) => ({ ...s, ratioHistoryDays: v }))}
                      label="Ratio history AUM average (days)"
                    />
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    Today&apos;s AUM <small>multiplied into the mean ratio</small>
                  </th>
                  <td colSpan={3}>
                    <div className="vm-inline">
                      <DaysSelect value={settings.ratioTodayDays} options={RATIO_TODAY_AUM_OPTIONS} onChange={pickRatioDays} label="Ratio today's AUM" />
                      {settings.ratioTodayDays === CUSTOM_AUM_DAYS && (
                        <CustomAumInput
                          key={slug}
                          value={table?.ratioAumCr ?? null}
                          onChange={(v) => setLocal((s) => ({ ...s, ratioCustomAum: { ...s.ratioCustomAum, [slug]: v } }))}
                          label="Ratio custom AUM (₹ Cr)"
                        />
                      )}
                    </div>
                  </td>
                </tr>
                <tr className="vm-grp">
                  <td colSpan={4}>Best fit</td>
                </tr>
                <tr>
                  <th scope="row">
                    Period <small>window the line is fitted on</small>
                  </th>
                  <td colSpan={3}>
                    <RangeButtons value={settings.bestFitRange} onChange={(v) => setLocal((s) => ({ ...s, bestFitRange: v }))} label="Best fit period" />
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    Line moving avg (days) <small>the AUM avg the line is fitted on</small>
                  </th>
                  <td colSpan={3}>
                    <AvgDaysInput
                      value={settings.bestFitMaDays}
                      onChange={(v) => setLocal((s) => ({ ...s, bestFitMaDays: v }))}
                      label="Best fit line moving average (days)"
                    />
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    AUM <small>where the line is read</small>
                  </th>
                  <td colSpan={3}>
                    <div className="vm-inline">
                      <DaysSelect value={settings.bestFitAumDays} options={VALUATION_AUM_DAYS_OPTIONS} onChange={pickBestFitDays} label="Best fit AUM" />
                      {settings.bestFitAumDays === CUSTOM_AUM_DAYS && (
                        <CustomAumInput
                          key={slug}
                          value={table?.bestFitAumCr ?? null}
                          onChange={(v) => setLocal((s) => ({ ...s, bestFitCustomAum: { ...s.bestFitCustomAum, [slug]: v } }))}
                          label="Best fit custom AUM (₹ Cr)"
                        />
                      )}
                    </div>
                  </td>
                </tr>
                <tr>
                  <th scope="row">AUM −/+ (%)</th>
                  <td colSpan={3}>
                    <input
                      className="vm-in"
                      inputMode="decimal"
                      aria-label="Best fit AUM move (%)"
                      value={settings.bestFitAumPct}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (e.target.value === "" || isBestFitAumPct(n)) setLocal((s) => ({ ...s, bestFitAumPct: e.target.value === "" ? 0 : n }));
                      }}
                    />
                  </td>
                </tr>
                <tr className="vm-ro">
                  <td colSpan={4}>
                    <button type="button" className="aa-btn" disabled={saving} onClick={saveSettings}>
                      {saving ? "Saving…" : "Save as default"}
                    </button>{" "}
                    <small>every setting here is shared, for all AMCs and everyone</small>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {table?.bestFitLine && table.bestFitLine.slope < 0 && (
          <p className="aa-warn" style={{ paddingTop: 10 }}>
            The {rangeText(settings.bestFitRange)} best fit line slopes down for this AMC (R² {table.bestFitLine.r2.toFixed(2)}), so its Bear sits
            above its Bull: a weak fit for this period.
          </p>
        )}
        <p className="aa-note" style={{ padding: "0 12px 12px" }}>
          PE, Mcap / Sales, PAT, revenue, shares and discount rates are edited in the Valuation · FY28E tables at the top.
        </p>
      </section>
    </>
  );
}

function DaysSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: number;
  options: readonly { value: number; label: string }[];
  onChange: (v: number) => void;
  label: string;
}) {
  // A saved value outside this list (e.g. an older 15D) still shows.
  const all = options.some((o) => o.value === value) ? options : [...options, { value, label: `${value}D avg` }];
  return (
    <select className="vm-sel" aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {all.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// The Custom choice's ₹ Cr box: Indian grouping until clicked; a figure
// that isn't a positive AUM is refused and the last good one comes back.
function CustomAumInput({ value, onChange, label }: { value: number | null; onChange: (v: number) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value === null ? "" : formatLedgerInr(value);
  const commit = () => {
    if (draft === null) return;
    const next = parseAumInput(draft);
    setDraft(null);
    if (next === null) {
      if (draft.trim() !== "") toast.error(`${label}: type an AUM in ₹ Cr, e.g. 4,80,000`);
      return;
    }
    if (next !== value) onChange(next);
  };
  return (
    <span className="vm-aum">
      <input
        className="vm-in"
        inputMode="decimal"
        aria-label={label}
        value={draft ?? shown}
        onFocus={(e) => {
          setDraft(value === null ? "" : String(Math.round(value)));
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </span>
  );
}

function RangeButtons({ value, onChange, label }: { value: RangeOption; onChange: (v: RangeOption) => void; label: string }) {
  return (
    <div className="vm-seg" role="group" aria-label={label}>
      {RANGE_OPTIONS.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// A whole number of days, 1–250; checked when you leave the box or press Enter.
function AvgDaysInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft.trim());
    setDraft(null);
    if (!isValuationAvgDays(n)) {
      toast.error(`${label}: a whole number of days from ${MIN_VALUATION_AVG_DAYS} to ${MAX_VALUATION_AVG_DAYS}`);
      return;
    }
    if (n !== value) onChange(n);
  };
  return (
    <input
      className="vm-in"
      inputMode="numeric"
      aria-label={label}
      value={draft ?? String(value)}
      onFocus={() => setDraft(String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
