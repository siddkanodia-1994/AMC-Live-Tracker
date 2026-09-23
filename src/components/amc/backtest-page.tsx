"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useAmcStockCorrelations } from "@/hooks/use-amc-stock-correlations";
import { BacktestPanel } from "./backtest-panel";

/**
 * Top-level "Backtest" tab (amc-grid.tsx's main tab bar). Just the data
 * fetch + loading/error boundary -- BacktestPanel itself now owns which
 * AMC is selected and the full config panel, so "Save as default" can
 * save both as one unit (mirrors StockCorrelationTable's own
 * single-component shape). Reuses the exact same data source the Stock
 * Correlation tab's own chart already fetches (all 8 listed-stock AMCs'
 * aumHistory/stockPriceSeries in one payload) -- no new API route.
 */
export function BacktestPage() {
  const { data, error, isLoading } = useAmcStockCorrelations();

  if (error) {
    return <p className="text-sm text-destructive">Failed to load backtest data: {error.message}</p>;
  }
  if (isLoading && !data) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  return <BacktestPanel amcs={data?.amcs ?? []} />;
}
