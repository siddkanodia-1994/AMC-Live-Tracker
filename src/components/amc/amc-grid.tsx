"use client";

import { useMemo, useState } from "react";
import { useLiveAum } from "@/hooks/use-live-aum";
import { AmcCard } from "./amc-card";
import { AumTrendChart } from "./aum-trend-chart";
import { SearchBar } from "@/components/layout/search-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCr, formatRelativeTime } from "@/lib/utils/format";
import type { LiveAumSnapshot } from "@/lib/aum/types";
import type { AumHistoryPoint } from "@/lib/aum/history";

const DHAN_STATUS_MESSAGE: Record<LiveAumSnapshot["dhanStatus"], string | null> = {
  ok: null,
  degraded:
    "Some holdings couldn't be priced live right now — their last reported value is shown instead.",
  unavailable:
    "DHAN pricing is unavailable — every AMC below is showing last reported values. Check the DHAN token in Admin settings.",
};

export function AmcGrid({
  initialData,
  history = [],
}: {
  initialData?: LiveAumSnapshot;
  history?: AumHistoryPoint[];
}) {
  const { data, error, isLoading } = useLiveAum(initialData);
  const [query, setQuery] = useState("");

  const filteredAmcs = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const list = q ? data.amcs.filter((a) => a.overviewName.toLowerCase().includes(q)) : data.amcs;
    return [...list].sort((a, b) => b.liveAumCr - a.liveAumCr);
  }, [data, query]);

  if (error && !data) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        {error.message.includes("No Excel file")
          ? "No data has been imported yet. Upload your Excel tracker from the Admin page to get started."
          : `Failed to load live AUM data: ${error.message}`}
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const statusMessage = DHAN_STATUS_MESSAGE[data.dhanStatus];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground">Total industry live AUM</div>
          <div className="text-3xl font-semibold tabular-nums">{formatCr(data.totalLiveAumCr)}</div>
          <div className="text-xs text-muted-foreground">
            Reported: {formatCr(data.totalReportedAumCr)} · Updated {formatRelativeTime(data.computedAt)}
          </div>
        </div>
        <SearchBar value={query} onChange={setQuery} />
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          {statusMessage}
        </div>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Industry AUM Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <AumTrendChart data={history} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredAmcs.map((amc) => (
          <AmcCard key={amc.amcId} amc={amc} />
        ))}
      </div>

      {filteredAmcs.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">No AMCs match &quot;{query}&quot;.</p>
      )}
    </div>
  );
}
