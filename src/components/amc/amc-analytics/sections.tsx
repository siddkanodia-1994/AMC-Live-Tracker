"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { mutate as globalMutate } from "swr";
import { AumTrendChart } from "@/components/amc/aum-trend-chart";
import { RegressionDeepDive } from "@/components/amc/regression-deep-dive";
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
import { PctChangeRegressionView } from "./pct-change-regression-view";
import type { StockCorrelationDefaults } from "@/lib/amc-stock/correlation-defaults";
import type { AmcStockCorrelationEntry } from "@/lib/amc-stock/correlation-summary";
import { RANGE_OPTIONS, type RangeOption } from "@/lib/aum/date-range";
import { trimToLastContinuousRun } from "@/lib/aum/series-math";
import { formatLedgerInr, formatLedgerPct } from "@/lib/aum/period-ledger";
import { computeValuationBlock, type FortnightlyFieldName, type FortnightlyManualFields, type FortnightlySheet } from "@/lib/aum/fortnightly-update";
import { useAmcValuation } from "@/hooks/use-amc-valuation";
import { withLiveValuationPoint } from "@/lib/valuation/provisional";
import { computeRatioLadder, RATIO_LADDER_SDS, type RatioLadder } from "@/lib/valuation/ratio-ladder";
import { computeTargetPrices, SCENARIO_KEYS, type TargetPriceTable, type ValuationMethodKey } from "@/lib/valuation/target-price";
import {
  DEFAULT_BEST_FIT_AUM_DAYS,
  DEFAULT_BEST_FIT_AUM_PCT,
  DEFAULT_VALUATION_RATIO_DAYS,
  isBestFitAumPct,
  isValuationAvgDays,
  MAX_VALUATION_AVG_DAYS,
  MIN_VALUATION_AVG_DAYS,
  RATIO_TODAY_AUM_OPTIONS,
  VALUATION_AUM_DAYS_OPTIONS,
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
  reset: () => void;
}

export function useFitControls(defaults: StockCorrelationDefaults | undefined): FitControls {
  // null = still on the saved setting.
  const [rangeChoice, setRangeChoice] = useState<RangeOption | null>(null);
  const [maInputChoice, setMaInputChoice] = useState<string | null>(null);
  const [aumOnlyChoice, setAumOnlyChoice] = useState<boolean | null>(null);
  const [levelsChoice, setLevelsChoice] = useState<boolean | null>(null);
  const maDaysInput = maInputChoice ?? (defaults ? savedMaInput(defaults.maDays) : "");
  // Same clamp and ~300ms debounce as the Stock Correlation table.
  const maDaysImmediate = Math.max(1, Math.min(250, parseInt(maDaysInput, 10) || 1));
  const [maDays, setMaDays] = useState(maDaysImmediate);
  useEffect(() => {
    const timer = setTimeout(() => setMaDays(maDaysImmediate), 300);
    return () => clearTimeout(timer);
  }, [maDaysImmediate]);
  const savedRange = defaults?.range ?? "3y";
  const savedMa = defaults?.maDays ?? 0;
  return {
    range: rangeChoice ?? savedRange,
    setRange: setRangeChoice,
    maDaysInput,
    setMaDaysInput: setMaInputChoice,
    maDays,
    aumOnlyAveraging: aumOnlyChoice ?? defaults?.aumOnlyAveraging ?? false,
    setAumOnlyAveraging: setAumOnlyChoice,
    levelsCorrelation: levelsChoice ?? defaults?.levelsCorrelation ?? false,
    setLevelsCorrelation: setLevelsChoice,
    onSaved: rangeChoice === null && maInputChoice === null && aumOnlyChoice === null && levelsChoice === null,
    savedLabel: `${RANGE_OPTIONS.find((o) => o.value === savedRange)?.label ?? savedRange} · ${savedMa > 1 ? `${savedMa}D` : "Latest"}`,
    reset: () => {
      setRangeChoice(null);
      setMaInputChoice(null);
      setAumOnlyChoice(null);
      setLevelsChoice(null);
    },
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

function SavedOrReset({ controls }: { controls: FitControls }) {
  return controls.onSaved ? (
    <span className="text-xs text-muted-foreground">On the saved settings ({controls.savedLabel})</span>
  ) : (
    <button type="button" className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted" onClick={controls.reset}>
      Back to saved ({controls.savedLabel})
    </button>
  );
}

// ── Ratio: the ratio ladder and the Stock Correlation "AUM vs. Share
// Price" chart, opening on its Ratio view ──────────────────────────────
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
  const { maDays, range, aumOnlyAveraging } = controls;
  const ladder = useMemo(
    () => (entry ? computeRatioLadder(entry.aumHistory, entry.stockPriceSeries, { maDays, range, aumOnlyAveraging }) : null),
    [entry, maDays, range, aumOnlyAveraging]
  );
  if (!entry || !defaults) return null;
  const lastPrice = entry.stockPriceSeries.at(-1)?.priceInr ?? null;
  return (
    <>
      <RatioLadderPanel
        ladder={ladder}
        maDays={maDays}
        aumOnlyAveraging={aumOnlyAveraging}
        cmpInr={cmpInr ?? lastPrice}
        cmpIsLive={cmpInr !== null && cmpIsLive}
      />

      <div className="aa-reused" style={{ marginTop: 16 }}>
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">AUM vs. Share Price</p>
            <div className="flex flex-wrap items-center gap-3">
              <ToggleBox
                id="aa-aum-only-avg"
                label="AUM-only avg"
                title="Moving avg applies only to AUM; the ratio uses each day's raw share price instead of an averaged one"
                checked={aumOnlyAveraging}
                onChange={controls.setAumOnlyAveraging}
              />
              <ToggleBox
                id="aa-levels-correlation"
                label="Levels (no % chg)"
                title="Corr/R² (Absolute view) use the two series' raw values directly instead of their day-over-day % change"
                checked={controls.levelsCorrelation}
                onChange={controls.setLevelsCorrelation}
              />
              <SavedOrReset controls={controls} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Range and Moving avg here also re-fit the Regression section. AUM-only avg changes the ratio ladder and this
            chart; Levels changes the Absolute view&apos;s Corr/R² and switches the Regression section to the daily % change model. None of these are saved, and the Valuation Model stays
            on the saved settings.
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
            levelsCorrelation={controls.levelsCorrelation}
            showReportedAum={false}
            initialView="ratio"
          />
        </div>
      </div>
    </>
  );
}

// ── Regression: the Regression tab's deep-dive (its ratio panel moved to
// the Ratio section), with the shared Range / Moving avg ───────────────
export function RegressionSection({
  entry,
  defaults,
  controls,
}: {
  entry: AmcStockCorrelationEntry | undefined;
  defaults: StockCorrelationDefaults | undefined;
  controls: FitControls;
}) {
  const result = useFitResult(entry, defaults, controls);
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
  return (
    <div className="aa-reused">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1" role="group" aria-label="Date range">
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
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
        <label htmlFor="aa-regression-ma" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Moving avg (days)
          <input
            id="aa-regression-ma"
            type="number"
            min={1}
            max={250}
            inputMode="numeric"
            value={controls.maDaysInput}
            onChange={(e) => controls.setMaDaysInput(e.target.value)}
            className="h-7 w-16 rounded-md border bg-background px-2 text-xs text-foreground"
          />
        </label>
        <ToggleBox
          id="aa-regression-levels"
          label="Levels (no % chg)"
          title="On: Price regressed on the AUM MA level. Off: the daily % change in the raw share price regressed on the daily % change in the AUM MA, with the target at live AUM vs its 45-day average"
          checked={levelsCorrelation}
          onChange={controls.setLevelsCorrelation}
        />
        <SavedOrReset controls={controls} />
        <span className="text-xs text-muted-foreground">Shared with the Ratio section; not saved.</span>
      </div>
      {levelsCorrelation ? (
        <RegressionDeepDive
          result={result}
          tradingSymbol={entry.tradingSymbol}
          maWindow={maDays}
          extraLagDays={defaults.extraLagDays}
          showScatter
          showRatioPanel={false}
        />
      ) : (
        <PctChangeRegressionView
          result={pctResult}
          tradingSymbol={entry.tradingSymbol}
          maWindow={maDays}
          extraLagDays={defaults.extraLagDays}
        />
      )}
    </div>
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
}

function dayText(days: number): string {
  return days === 0 ? "live" : `${days}D-avg`;
}

function rangeText(range: RangeOption): string {
  return RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range;
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
}: {
  value: number | null;
  onSave: (v: number | null) => Promise<void>;
  ariaLabel: string;
  decimals?: number;
  scale?: number;
  placeholder?: string;
  muted?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value === null ? "" : String(Number((value * scale).toFixed(decimals)));
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
      value={draft ?? shown}
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

// ── Valuation Model: the Fortnightly tab's Bear / Base / Bull valuation,
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
  manual: FortnightlyManualFields;
  cmpInr: number | null;
  editable: boolean;
  saveField: (field: FortnightlyFieldName, value: number | null) => Promise<void>;
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
        </tbody>
      </table>
      <table className="vs-t vs-sub">
        <tbody>
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
        </tbody>
      </table>
      <table className="vs-t vs-sub">
        <tbody>
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
  sheet,
  onSheetSaved,
  amcOptions,
  onSlugChange,
  cmpInr,
  cmpIsLive,
}: {
  slug: string;
  entry: AmcStockCorrelationEntry | undefined;
  defaults: StockCorrelationDefaults | undefined;
  sheet: FortnightlySheet | undefined;
  onSheetSaved: () => Promise<unknown>;
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
  };
  const sheetForSlug = sheet && sheet.slug === slug ? sheet : undefined;

  const table = useMemo(() => {
    if (!entry || !defaults || !sheetForSlug) return null;
    return computeTargetPrices({
      aumHistory: entry.aumHistory,
      stockPriceSeries: entry.stockPriceSeries,
      ratioRange: settings.ratioRange,
      ratioHistoryDays: settings.ratioHistoryDays,
      ratioTodayDays: settings.ratioTodayDays,
      bestFitRange: settings.bestFitRange,
      bestFitMaDays: settings.bestFitMaDays,
      extraLagDays: defaults.extraLagDays,
      bestFitAumDays: settings.bestFitAumDays,
      bestFitAumPct: settings.bestFitAumPct,
      manual: sheetForSlug.manual,
      mcapSalesSeries: withLiveValuationPoint(valuation?.points ?? [], entry.stockPriceSeries.at(-1), entry.stockPriceSeries).flatMap((p) => (p.mcapToSales === null ? [] : [{ date: p.date, value: p.mcapToSales }])),
      cmpInr,
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
    cmpInr,
  ]);

  async function saveField(field: FortnightlyFieldName, value: number | null) {
    if (!sheetForSlug) return;
    const res = await fetch("/api/fortnightly-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amcId: sheetForSlug.amcId, asOfDate: sheetForSlug.asOfDate, field, value }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Failed to save");
    }
    await onSheetSaved();
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
  const editable = !!sheetForSlug?.isLatest;
  const band = table?.mcapSalesBand ?? null;

  return (
    <>
      <section className="pl-panel vm" aria-label="Valuation FY28E" style={{ marginBottom: 16 }}>
        <div className="pl-band">
          Valuation · FY28E{" "}
          <span className="pl-band-unit">
            Bear / Base / Bull · income ₹ Cr · targets ₹ per share · same inputs and maths as the Fortnightly AMC Update tab
          </span>
        </div>
        {!m ? (
          <p className="aa-note" style={{ padding: 12 }}>
            Loading the Fortnightly inputs…
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
          {editable
            ? "Blue cells save to the latest Fortnightly AMC Update snapshot, so this tab and the Fortnightly tab always show the same numbers."
            : "Showing a past Fortnightly snapshot: inputs are read-only here."}{" "}
          Grey Mcap / Sales multiples are the chart&apos;s 3Y −1 SD / Mean / +1 SD; type to override, clear to go back to the band.
          Target Price Current is the PE / Mcap / Sales row of the Target Price table below.
          {cmpInr !== null && sheetForSlug?.cmpInr != null && cmpInr !== sheetForSlug.cmpInr
            ? ` Upsides use today's price; the Fortnightly tab measures them against its snapshot close (₹${sheetForSlug.cmpInr.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).`
            : ""}
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
            Loading the Fortnightly inputs…
          </p>
        ) : (
          <div className="vm-grid">
            <table className="vm-t">
              <thead>
                <tr>
                  <th scope="col">Method</th>
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
                    {SCENARIO_KEYS.map((k) => (
                      <PriceCell key={k} price={table.methods[row.key][k]} upside={table.upside[row.key][k]} />
                    ))}
                  </tr>
                ))}
                <tr className="vm-avg">
                  <th scope="row">
                    <b>Average</b>
                    <small>Of the methods with a value: {table.averageCount.base} of 4</small>
                  </th>
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
                    <DaysSelect
                      value={settings.ratioTodayDays}
                      options={RATIO_TODAY_AUM_OPTIONS}
                      onChange={(v) => setLocal((s) => ({ ...s, ratioTodayDays: v }))}
                      label="Ratio today's AUM"
                    />
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
                    <DaysSelect
                      value={settings.bestFitAumDays}
                      options={VALUATION_AUM_DAYS_OPTIONS}
                      onChange={(v) => setLocal((s) => ({ ...s, bestFitAumDays: v }))}
                      label="Best fit AUM"
                    />
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
