"use client";

import { useMemo, useState } from "react";
import { useAmcStockCorrelations } from "@/hooks/use-amc-stock-correlations";
import { RelativeTime } from "@/components/ui/relative-time";
import { RANGE_OPTIONS, type RangeOption } from "@/lib/aum/date-range";
import {
  MA_WINDOW_OPTIONS,
  EXTRA_LAG_OPTIONS,
  computeRegressionResult,
  type MaWindow,
  type ExtraLagDays,
  type RegressionResult,
} from "@/lib/amc-stock/regression-engine";
import { RegressionDeepDive } from "./regression-deep-dive";

const selectClass =
  "min-w-0 max-w-[260px] rounded-md border bg-background px-2 py-1 text-sm hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

const DEFAULT_SLUG = "hdfc-mutual-fund";
const DEFAULT_MA_WINDOW: MaWindow = 45;
const DEFAULT_EXTRA_LAG: ExtraLagDays = 0;
const DEFAULT_RANGE: RangeOption = "3y";

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

      {entry && (
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
      )}

      {entry && <RegressionDeepDive result={result} tradingSymbol={entry.tradingSymbol} maWindow={maWindow} extraLagDays={extraLagDays} />}
    </div>
  );
}
