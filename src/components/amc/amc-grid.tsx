"use client";

import { useMemo, useState } from "react";
import { useLiveAum } from "@/hooks/use-live-aum";
import { AmcTable } from "./amc-table";
import { AumDeltaBadge } from "./aum-delta-badge";
import { AumTrendChart } from "./aum-trend-chart";
import { MarketStatusBadge } from "@/components/layout/market-status-badge";
import { SearchBar } from "@/components/layout/search-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCr, formatRelativeTime, formatShortDate } from "@/lib/utils/format";
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
    return q ? data.amcs.filter((a) => a.overviewName.toLowerCase().includes(q)) : data.amcs;
  }, [data, query]);

  const industryTotals = useMemo(() => {
    if (!data) return null;
    const totalAvgAumCr = data.amcs.reduce((sum, a) => sum + (a.avgLiveAumCr ?? a.reportedAumCr), 0);
    const liveDeltaCr = data.totalLiveAumCr - data.totalReportedAumCr;
    const avgDeltaCr = totalAvgAumCr - data.totalReportedAumCr;
    return {
      totalAvgAumCr,
      liveDeltaCr,
      liveDeltaPct: data.totalReportedAumCr !== 0 ? liveDeltaCr / data.totalReportedAumCr : 0,
      avgDeltaCr,
      avgDeltaPct: data.totalReportedAumCr !== 0 ? avgDeltaCr / data.totalReportedAumCr : 0,
    };
  }, [data]);

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
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!data || !industryTotals) return null;

  // Prefer the specific reason the last DHAN call failed (expired token, rate
  // limit, network error) over the generic per-status guess — the generic
  // messages exist only for the case where DHAN's call succeeded but some
  // individual holdings just don't have a quote (no specific cause to report).
  const statusMessage = data.dhanErrorDetail
    ? `DHAN pricing issue: ${data.dhanErrorDetail}`
    : DHAN_STATUS_MESSAGE[data.dhanStatus];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm font-normal text-muted-foreground">
                  Total industry live AUM
                </CardTitle>
                <MarketStatusBadge />
              </div>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="text-3xl font-semibold tabular-nums">{formatCr(data.totalLiveAumCr)}</div>
                <AumDeltaBadge deltaCr={industryTotals.liveDeltaCr} deltaPct={industryTotals.liveDeltaPct} />
              </div>
              <div className="text-xs text-muted-foreground">
                Reported: {formatCr(data.totalReportedAumCr)} ·{" "}
                {data.pricesAreLive
                  ? `Updated ${formatRelativeTime(data.computedAt)}`
                  : `Prices as of ${formatShortDate(data.priceAsOfDate)} close`}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-normal text-muted-foreground">
                Average industry AUM since last report
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="text-3xl font-semibold tabular-nums">
                  {formatCr(industryTotals.totalAvgAumCr)}
                </div>
                <AumDeltaBadge deltaCr={industryTotals.avgDeltaCr} deltaPct={industryTotals.avgDeltaPct} />
              </div>
              <div className="text-xs text-muted-foreground">
                Reported: {formatCr(data.totalReportedAumCr)} · Averaged since June 1
              </div>
            </CardContent>
          </Card>
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

      <div>
        <p className="mb-2 text-xs text-muted-foreground">
          &quot;Avg AUM&quot; is the average of daily live AUM since the last reported month closed
          (May), used to compare against the last officially reported figure. The &quot;Industry
          Total&quot; row&apos;s Holdings/Debt/Live Priced counts are de-duplicated by stock across
          the whole industry (a stock held by 50 AMCs counts once, not 50 times) — always all 56
          AMCs, unaffected by the Top-N selector or search. The row above it sums whichever AMCs
          are currently shown instead, so a shared stock can be counted more than once there.
        </p>
        <AmcTable
          amcs={filteredAmcs}
          allAmcs={data.amcs}
          isSearchActive={query.trim() !== ""}
          distinctHoldingsCount={data.distinctHoldingsCount}
          distinctDebtInstrumentCount={data.distinctDebtInstrumentCount}
          distinctLivePricedCount={data.distinctLivePricedCount}
        />
      </div>

      {filteredAmcs.length === 0 && (
        <p className="text-center text-sm text-muted-foreground">No AMCs match &quot;{query}&quot;.</p>
      )}
    </div>
  );
}
