"use client";

import { useLiveAumDetail, type AmcDetailResponse } from "@/hooks/use-live-aum-detail";
import { AumDeltaBadge } from "./aum-delta-badge";
import { AumTrendChart } from "./aum-trend-chart";
import { HoldingsTable } from "./holdings-table";
import { SectorBreakdown } from "./sector-breakdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCr, formatRelativeTime } from "@/lib/utils/format";
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
            Updated {formatRelativeTime(data.computedAt)} · Report period {amc.reportPeriod}
          </p>
        </div>
        <AumDeltaBadge deltaCr={amc.deltaCr} deltaPct={amc.deltaPct} />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Live AUM" value={formatCr(amc.liveAumCr)} />
        <Stat label="Reported AUM" value={formatCr(amc.reportedAumCr)} />
        <Stat label="Cash & other (fixed)" value={formatCr(amc.residualPlugCr)} />
        <Stat label="Holdings" value={`${amc.holdingsCount}${amc.stalePricedCount > 0 ? ` (${amc.stalePricedCount} stale)` : ""}`} />
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
        </TabsList>
        <TabsContent value="holdings">
          <HoldingsTable holdings={holdings} />
        </TabsContent>
        <TabsContent value="sectors">
          <SectorBreakdown holdings={holdings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
