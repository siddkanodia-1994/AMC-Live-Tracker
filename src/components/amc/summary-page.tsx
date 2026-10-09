"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useAmcStockCorrelations } from "@/hooks/use-amc-stock-correlations";
import { useIndustryMonthlyFlows } from "@/hooks/use-industry-monthly-flows";
import { SummaryPanel } from "./summary-panel";

// Reuses the exact same data source the Stock Correlation tab's own chart
// already fetches (all 8 listed-stock AMCs' aumHistory in one payload) --
// no new API route, same SWR cache key.
export function SummaryPage() {
  const { data, error, isLoading } = useAmcStockCorrelations();
  // Separate, independent fetch -- its own loading/error state never gates
  // the per-AMC blocks above, since it's unrelated, industry-wide data for
  // a toggle-able panel, not something the rest of the tab depends on.
  const flows = useIndustryMonthlyFlows();

  if (error) {
    return <p className="text-sm text-destructive">Failed to load summary data: {error.message}</p>;
  }
  if (isLoading && !data) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }
  return <SummaryPanel amcs={data?.amcs ?? []} flowsPoints={flows.data?.points ?? null} />;
}
