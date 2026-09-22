"use client";

import { useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAmcStockCorrelations } from "@/hooks/use-amc-stock-correlations";
import { BacktestPanel } from "./backtest-panel";

const amcSelectClass =
  "w-56 rounded-md border bg-background px-2 py-1 text-xs hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

// HDFC by default -- same convention stock-correlation-table.tsx's own
// worked example uses (EXPLAINER_AMC_SLUG).
const DEFAULT_AMC_SLUG = "hdfc-mutual-fund";

/**
 * Top-level "Backtest" tab (amc-grid.tsx's main tab bar) -- one AMC's
 * results at a time, switchable via the dropdown below, rather than the
 * feature living under each AMC's own page. Reuses the exact same data
 * source the Stock Correlation tab's own chart already fetches (all 8
 * listed-stock AMCs' aumHistory/stockPriceSeries in one payload) -- no
 * new API route.
 */
export function BacktestPage() {
  const { data, error, isLoading } = useAmcStockCorrelations();
  const [amcSlug, setAmcSlug] = useState(DEFAULT_AMC_SLUG);
  const entry = useMemo(() => data?.amcs.find((a) => a.slug === amcSlug) ?? null, [data, amcSlug]);

  if (error) {
    return <p className="text-sm text-destructive">Failed to load backtest data: {error.message}</p>;
  }
  if (isLoading && !data) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Backtest</p>
        <div className="flex items-center gap-2">
          <label htmlFor="backtest-amc-select" className="text-xs text-muted-foreground">
            AMC
          </label>
          <select id="backtest-amc-select" value={amcSlug} onChange={(e) => setAmcSlug(e.target.value)} className={amcSelectClass}>
            {data?.amcs.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.overviewName}
              </option>
            ))}
          </select>
        </div>
      </div>
      {entry && <BacktestPanel history={entry.aumHistory} stockPriceSeries={entry.stockPriceSeries} stockLabel={entry.tradingSymbol} />}
    </div>
  );
}
