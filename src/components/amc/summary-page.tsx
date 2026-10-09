"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useAmcStockCorrelations } from "@/hooks/use-amc-stock-correlations";
import { SummaryPanel } from "./summary-panel";

// Reuses the exact same data source the Stock Correlation tab's own chart
// already fetches (all 8 listed-stock AMCs' aumHistory in one payload) --
// no new API route, same SWR cache key.
export function SummaryPage() {
  const { data, error, isLoading } = useAmcStockCorrelations();

  if (error) {
    return <p className="text-sm text-destructive">Failed to load summary data: {error.message}</p>;
  }
  if (isLoading && !data) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }
  return <SummaryPanel amcs={data?.amcs ?? []} />;
}
