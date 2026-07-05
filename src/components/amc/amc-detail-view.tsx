"use client";

import type { ReactNode } from "react";
import { useLiveAumDetail, type AmcDetailResponse } from "@/hooks/use-live-aum-detail";
import { AumDeltaBadge } from "./aum-delta-badge";
import { AumTrendChart } from "./aum-trend-chart";
import { HoldingsTable } from "./holdings-table";
import { PeriodComparisonTable } from "./period-comparison-table";
import { SectorBreakdown } from "./sector-breakdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCr, formatDeltaCr, formatPct, formatRelativeTime, formatShortDate } from "@/lib/utils/format";
import type { AumHistoryPoint } from "@/lib/aum/history";

export function AmcDetailView({
  slug,
  initialData,
  history,
}: {
  slug: string;
  initialData?: AmcDetailResponse;
  history: AumHistoryPoint[];
}) {
  const { data, error, isLoading } = useLiveAumDetail(slug, initialData);

  if (error && !data) {
    return (
      <p className="text-center text-muted-foreground">Failed to load this AMC: {error.message}</p>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!data) return null;

  const { amc, holdings } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{amc.overviewName}</h1>
          <p className="text-sm text-muted-foreground">
            {data.pricesAreLive
              ? `Updated ${formatRelativeTime(data.computedAt)}`
              : `Prices as of ${formatShortDate(data.priceAsOfDate)} close`}{" "}
            · Report period {amc.reportPeriod}
          </p>
        </div>
        <AumDeltaBadge deltaCr={amc.deltaCr} deltaPct={amc.deltaPct} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Live AUM"
          value={formatCr(amc.liveAumCr)}
          badge={<AumDeltaBadge deltaCr={amc.deltaCr} deltaPct={amc.deltaPct} />}
        />
        <Stat label="Reported AUM" value={formatCr(amc.reportedAumCr)} />
        <Stat
          label="Cash and cash equivalent"
          value={formatCr(amc.cashEquivalentCr)}
          subtext={amc.reportedAumCr !== 0 ? `${formatPct(amc.cashEquivalentCr / amc.reportedAumCr)} of reported AUM` : undefined}
        />
        <Stat
          label="Bank Debt & Repo"
          value={formatCr(amc.bankDebtRepoCr)}
          subtext={amc.reportedAumCr !== 0 ? `${formatPct(amc.bankDebtRepoCr / amc.reportedAumCr)} of reported AUM` : undefined}
        />
        <Stat label="Holdings" value={`${amc.holdingsCount}${amc.stalePricedCount > 0 ? ` (${amc.stalePricedCount} stale)` : ""}`} />
        <Stat
          label="Est. Net Flow"
          value={amc.netFlowCr !== null ? formatDeltaCr(amc.netFlowCr) : "—"}
          badge={
            amc.netFlowCr !== null && amc.netFlowPct !== null ? (
              <AumDeltaBadge deltaCr={amc.netFlowCr} deltaPct={amc.netFlowPct} />
            ) : undefined
          }
          subtext={
            amc.netFlowCr !== null
              ? `${amc.reportPeriod} reported vs ${amc.netFlowPriorPeriod}-based baseline of ${formatCr(amc.netFlowBaselineCr ?? 0)}`
              : "No prior-period baseline yet"
          }
          title="Reported AUM minus what AUM would be if the prior period's holdings had simply been repriced through this month-end (no trading). Conflates investor subscriptions/redemptions with the manager's own buying/selling — an approximation, not a pure flows figure."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AUM Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <AumTrendChart data={history} />
        </CardContent>
      </Card>

      <Tabs defaultValue="holdings">
        <TabsList>
          <TabsTrigger value="holdings">Holdings</TabsTrigger>
          <TabsTrigger value="sectors">Sector Allocation</TabsTrigger>
          <TabsTrigger value="comparison">Period Comparison</TabsTrigger>
        </TabsList>
        <TabsContent value="holdings">
          {/* Full-bleed: this table has too many columns to fit inside the
              page's max-w-6xl reading width, so it breaks out to the full
              viewport width regardless of nesting, while the cards/chart
              above stay at the normal reading width. */}
          <div className="relative left-1/2 right-1/2 -mx-[50vw] w-screen">
            <div className="mx-auto max-w-[1800px] px-4 sm:px-6">
              <HoldingsTable holdings={holdings} />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="sectors">
          <SectorBreakdown holdings={holdings} />
        </TabsContent>
        <TabsContent value="comparison">
          <div className="relative left-1/2 right-1/2 -mx-[50vw] w-screen">
            <div className="mx-auto max-w-[1800px] px-4 sm:px-6">
              <PeriodComparisonTable slug={slug} />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({
  label,
  value,
  badge,
  subtext,
  title,
}: {
  label: string;
  value: string;
  badge?: ReactNode;
  subtext?: string;
  title?: string;
}) {
  return (
    <div className="rounded-lg border p-3" title={title}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="text-lg font-semibold tabular-nums whitespace-nowrap">{value}</div>
        {badge}
      </div>
      {subtext && <div className="text-xs text-muted-foreground">{subtext}</div>}
    </div>
  );
}
