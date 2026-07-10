"use client";

import { useMemo, useState } from "react";
import { useLiveAum } from "@/hooks/use-live-aum";
import { useOverviewAdjustments } from "@/hooks/use-overview-adjustments";
import { AmcTable } from "./amc-table";
import { AumDeltaBadge } from "./aum-delta-badge";
import { FreshnessBadge } from "./freshness-badge";
import { AumGrowthTable } from "./aum-growth-table";
import { AumTrendChart } from "./aum-trend-chart";
import { TotalAumGrowthTable } from "./total-aum-growth-table";
import { CashHoldingsTable } from "@/components/cash-holdings/cash-holdings-table";
import { MarketStatusBadge } from "@/components/layout/market-status-badge";
import { SearchBar } from "@/components/layout/search-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatCr, formatDeltaCr, formatPct, formatReportPeriodLabel, formatShortDate } from "@/lib/utils/format";
import { DEFAULT_TOP_N, TOP_N_OPTIONS, type TopNOption } from "@/lib/utils/top-n";
import type { LiveAumSnapshot } from "@/lib/aum/types";
import type { AumHistoryPoint } from "@/lib/aum/history";

const DHAN_UNAVAILABLE_MESSAGE =
  "DHAN pricing is unavailable — every AMC below is showing last reported values. Check the DHAN token in Admin settings.";

const dateInputClass =
  "rounded-md border bg-background px-2 py-1 text-sm hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

export function AmcGrid({
  initialData,
  history = [],
}: {
  initialData?: LiveAumSnapshot;
  history?: AumHistoryPoint[];
}) {
  // null = live mode; a date = the Overview is repriced to that historical
  // day's canonical snapshots. Deliberately NOT persisted — a refresh always
  // lands back on live data.
  const [asOfDate, setAsOfDate] = useState<string | null>(null);
  const { data, error, isLoading } = useLiveAum(initialData, asOfDate ?? undefined);
  const [query, setQuery] = useState("");
  // The Overview table's own two adjustable views -- independent of asOfDate
  // above (that's "reprice the whole page to a historical day"; these are
  // "look at a different reported month / a custom Avg AUM window on today's
  // table"). null = use the server's current-period/default-window
  // resolution. Deliberately not persisted, same as asOfDate.
  const [selectedReportPeriod, setSelectedReportPeriod] = useState<string | null>(null);
  const [avgFrom, setAvgFrom] = useState<string | null>(null);
  const [avgTo, setAvgTo] = useState<string | null>(null);
  // "Avg Live AUM" column's own independent window -- defaults to the
  // current fiscal quarter to date, same null-means-default convention.
  const [currentAvgFrom, setCurrentAvgFrom] = useState<string | null>(null);
  const [currentAvgTo, setCurrentAvgTo] = useState<string | null>(null);
  const adjustments = useOverviewAdjustments(
    selectedReportPeriod ?? undefined,
    avgFrom ?? undefined,
    avgTo ?? undefined,
    currentAvgFrom ?? undefined,
    currentAvgTo ?? undefined
  );
  // Purely a display toggle on the trend chart below -- doesn't touch `history`.
  const [chartMode, setChartMode] = useState<"absolute" | "change">("absolute");
  // Shared across all three tabs -- lifted here (rather than each tab owning
  // its own) so changing it in one applies to all, per the "linked toggle"
  // requirement. Each tab still independently decides what "Top N" ranks by
  // (Live AUM here, periodB's reported AUM on AUM Growth, current reported
  // AUM on Cash Holdings), since none of those have a common shared field.
  const [topN, setTopN] = useState<TopNOption>(DEFAULT_TOP_N);

  // Overlays the Reported AUM month / Avg AUM range / Avg Live AUM range
  // adjustments onto the live snapshot's AMC rows, recomputing Live vs
  // Reported and Avg AUM QoQ Change against whichever figures are now in
  // effect. Falls back to the snapshot's own (current-period-default)
  // values until the adjustments fetch resolves, which numerically match
  // anyway when nothing has been picked -- no flash of different numbers on
  // first load.
  const adjustedAmcs = useMemo(() => {
    if (!data) return [];
    const adj = adjustments.data;
    if (!adj) return data.amcs;
    return data.amcs.map((amc) => {
      const reportedAumCr = adj.reportedAumByAmcId[amc.amcId] ?? amc.reportedAumCr;
      const avgOverride = adj.avgAumByAmcId[amc.amcId];
      const avgLiveAumCr = avgOverride ? avgOverride.avgLiveAumCr : null;
      const avgWindowDays = avgOverride ? avgOverride.daysCount : 0;
      const currentAvgOverride = adj.currentAvgAumByAmcId[amc.amcId];
      const currentQuarterAvgLiveAumCr = currentAvgOverride ? currentAvgOverride.avgLiveAumCr : null;
      const deltaCr = amc.liveAumCr - reportedAumCr;
      const deltaPct = reportedAumCr !== 0 ? deltaCr / reportedAumCr : 0;
      const avgVsReportedPct = avgLiveAumCr !== null && reportedAumCr !== 0 ? avgLiveAumCr / reportedAumCr - 1 : null;
      const avgAumQoQChangePct =
        currentQuarterAvgLiveAumCr !== null && avgLiveAumCr !== null && avgLiveAumCr !== 0
          ? currentQuarterAvgLiveAumCr / avgLiveAumCr - 1
          : null;
      return {
        ...amc,
        reportedAumCr,
        avgLiveAumCr,
        avgWindowDays,
        deltaCr,
        deltaPct,
        avgVsReportedPct,
        currentQuarterAvgLiveAumCr,
        avgAumQoQChangePct,
      };
    });
  }, [data, adjustments.data]);

  const filteredAmcs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? adjustedAmcs.filter((a) => a.overviewName.toLowerCase().includes(q)) : adjustedAmcs;
  }, [adjustedAmcs, query]);

  const industryTotals = useMemo(() => {
    if (!data) return null;
    const totalAvgAumCr = data.amcs.reduce((sum, a) => sum + (a.avgLiveAumCr ?? a.reportedAumCr), 0);
    const liveDeltaCr = data.totalLiveAumCr - data.totalReportedAumCr;
    const avgDeltaCr = totalAvgAumCr - data.totalReportedAumCr;
    // Falls back to today's own liveAumCr (not skipping the AMC) for any AMC
    // with no prior-day figure yet -- that AMC contributes zero change to the
    // total rather than distorting it or requiring a separate exclusion set,
    // same reasoning as the avgLiveAumCr fallback just above. Deliberately
    // derived from data.amcs (the live snapshot), not adjustedAmcs -- this
    // top-level card stays anchored to the current period regardless of the
    // table's own Reported AUM month / Avg AUM range pickers below.
    const totalPreviousDayLiveAumCr = data.amcs.reduce((sum, a) => sum + (a.previousDayLiveAumCr ?? a.liveAumCr), 0);
    const oneDayChangeCr = data.totalLiveAumCr - totalPreviousDayLiveAumCr;
    return {
      totalAvgAumCr,
      liveDeltaCr,
      liveDeltaPct: data.totalReportedAumCr !== 0 ? liveDeltaCr / data.totalReportedAumCr : 0,
      avgDeltaCr,
      avgDeltaPct: data.totalReportedAumCr !== 0 ? avgDeltaCr / data.totalReportedAumCr : 0,
      totalPreviousDayLiveAumCr,
      oneDayChangeCr,
      oneDayChangePct: totalPreviousDayLiveAumCr !== 0 ? oneDayChangeCr / totalPreviousDayLiveAumCr : null,
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

  // Warn ONLY on genuine problems: a call-level failure (expired token, rate
  // limit, network error — dhanErrorDetail), a total outage, or stocks that
  // were being priced live before but stopped (last-close regression). A
  // "degraded" status alone stays silent — it fires perpetually for illiquid
  // holdings DHAN simply never quotes, which is benign.
  const lastCloseCount = data.distinctLastCloseCount ?? 0;
  const statusMessage = data.dhanErrorDetail
    ? `DHAN pricing issue: ${data.dhanErrorDetail}`
    : data.dhanStatus === "unavailable"
      ? DHAN_UNAVAILABLE_MESSAGE
      : data.pricesAreLive && lastCloseCount > 0
        ? `${lastCloseCount} stock${lastCloseCount === 1 ? "" : "s"} that previously had live prices ${lastCloseCount === 1 ? "is" : "are"} no longer being priced live — showing their last close instead.`
        : null;

  // First day of the month after the report period — when the Avg AUM window opened.
  const [periodYear, periodMonth] = data.reportPeriod.split("-").map(Number);
  const avgWindowStartLabel = formatShortDate(
    `${periodMonth === 12 ? periodYear + 1 : periodYear}-${String((periodMonth % 12) + 1).padStart(2, "0")}-01`
  );

  // Resolved labels for the table's two adjustable columns -- fall back to
  // the same current-period-default wording the app already used before the
  // adjustments fetch resolves, so there's no flash of placeholder text.
  const reportedAumPeriodLabel = formatReportPeriodLabel(adjustments.data?.reportPeriod ?? data.reportPeriod);
  const avgWindowLabel = adjustments.data
    ? `${formatShortDate(adjustments.data.avgFrom)} – ${formatShortDate(adjustments.data.avgTo)}`
    : `since ${avgWindowStartLabel}`;
  const currentAvgWindowLabel = adjustments.data
    ? `${formatShortDate(adjustments.data.currentAvgFrom)} – ${formatShortDate(adjustments.data.currentAvgTo)}`
    : "current quarter";
  const reportPeriodOptions = adjustments.data?.availableReportPeriods ?? [data.reportPeriod];
  const adjustmentsTouched =
    selectedReportPeriod !== null || avgFrom !== null || avgTo !== null || currentAvgFrom !== null || currentAvgTo !== null;

  const oneDayChangeIsFlat = Math.abs(industryTotals.oneDayChangeCr) < 0.01;
  const oneDayChangeColorClass =
    industryTotals.oneDayChangePct === null || oneDayChangeIsFlat
      ? "text-muted-foreground"
      : industryTotals.oneDayChangeCr > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-normal text-muted-foreground">
                Total Industry Equity Live AUM
              </CardTitle>
              <MarketStatusBadge />
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="text-3xl font-bold tabular-nums">{formatCr(data.totalLiveAumCr)}</div>
              <AumDeltaBadge deltaCr={industryTotals.liveDeltaCr} deltaPct={industryTotals.liveDeltaPct} />
            </div>
            <div className="text-xs text-muted-foreground">
              Reported: {formatCr(data.totalReportedAumCr)} ·{" "}
              {data.pricesAreLive ? (
                <>
                  Updated <RelativeTime iso={data.computedAt} />
                </>
              ) : (
                `Prices as of ${formatShortDate(data.priceAsOfDate)} close`
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">
              Average Industry Equity AUM since last report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {data.asOfDate ? (
              <>
                <div className="text-3xl font-semibold tabular-nums text-muted-foreground">—</div>
                <div className="text-xs text-muted-foreground">Not available for historical dates</div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="text-3xl font-semibold tabular-nums">{formatCr(industryTotals.totalAvgAumCr)}</div>
                  <AumDeltaBadge deltaCr={industryTotals.avgDeltaCr} deltaPct={industryTotals.avgDeltaPct} />
                </div>
                <div className="text-xs text-muted-foreground">
                  Reported: {formatCr(data.totalReportedAumCr)} · Averaged since {avgWindowStartLabel}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-normal text-muted-foreground">Industry Equity AUM Daily Change</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {industryTotals.oneDayChangePct !== null ? (
              <>
                <div className={`text-3xl font-bold tabular-nums ${oneDayChangeColorClass}`}>
                  {formatPct(industryTotals.oneDayChangePct, { alwaysSign: true })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {`${formatDeltaCr(industryTotals.oneDayChangeCr)} vs yesterday's close (${formatCr(industryTotals.totalPreviousDayLiveAumCr)})`}
                </div>
              </>
            ) : (
              <>
                <div className="text-3xl font-semibold tabular-nums text-muted-foreground">—</div>
                <div className="text-xs text-muted-foreground">No prior-day data yet</div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="flex justify-end">
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Industry Equity AUM Trend</CardTitle>
              <div className="flex items-center gap-1 text-sm">
                {(["absolute", "change"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setChartMode(mode)}
                    className={`rounded-md px-2 py-1 ${
                      chartMode === mode ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {mode === "absolute" ? "Absolute" : "% Change"}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <AumTrendChart data={history} mode={chartMode} />
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="overview">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="aum-growth">Equity AUM Growth</TabsTrigger>
            <TabsTrigger value="total-aum-growth">Total AUM Growth</TabsTrigger>
            <TabsTrigger value="cash-holdings">Cash Holdings</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-1 text-sm">
            <span className="text-muted-foreground">Show:</span>
            {TOP_N_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTopN(option)}
                className={`rounded-md px-2 py-1 ${
                  topN === option ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option === "all" ? "All" : `Top ${option}`}
              </button>
            ))}
          </div>
        </div>
        <TabsContent value="overview">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Live AUM as of</span>
            <input
              type="date"
              value={asOfDate ?? ""}
              min={data.minSnapshotDate ?? undefined}
              max={data.maxSnapshotDate ?? undefined}
              onChange={(e) => setAsOfDate(e.target.value || null)}
              className={dateInputClass}
            />
            {asOfDate && (
              <button
                type="button"
                onClick={() => setAsOfDate(null)}
                className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Back to live
              </button>
            )}
            {asOfDate && (
              <span className="text-xs text-muted-foreground">
                Historical view — Avg AUM, Est. Net Flow and holdings counts apply only to live data
              </span>
            )}
            {!data.asOfDate && (
              <FreshnessBadge
                computedAt={data.computedAt}
                pricesAreLive={data.pricesAreLive}
                priceAsOfDate={data.priceAsOfDate}
                dhanStatus={data.dhanStatus}
                dhanErrorDetail={data.dhanErrorDetail}
                distinctLastCloseCount={lastCloseCount}
                maxSnapshotDate={data.maxSnapshotDate ?? null}
              />
            )}
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Reported AUM month</span>
            <select
              value={adjustments.data?.reportPeriod ?? data.reportPeriod}
              onChange={(e) => setSelectedReportPeriod(e.target.value)}
              className={dateInputClass}
            >
              {reportPeriodOptions.map((p) => (
                <option key={p} value={p}>
                  {formatReportPeriodLabel(p)}
                </option>
              ))}
            </select>
            <span className="ml-2 text-muted-foreground">Avg AUM from</span>
            <input
              type="date"
              value={avgFrom ?? adjustments.data?.avgFrom ?? ""}
              min={adjustments.data?.minSnapshotDate ?? undefined}
              max={adjustments.data?.maxSnapshotDate ?? undefined}
              onChange={(e) => setAvgFrom(e.target.value || null)}
              className={dateInputClass}
            />
            <span className="text-muted-foreground">to</span>
            <input
              type="date"
              value={avgTo ?? adjustments.data?.avgTo ?? ""}
              min={avgFrom ?? adjustments.data?.minSnapshotDate ?? undefined}
              max={adjustments.data?.maxSnapshotDate ?? undefined}
              onChange={(e) => setAvgTo(e.target.value || null)}
              className={dateInputClass}
            />
            {adjustmentsTouched && (
              <button
                type="button"
                onClick={() => {
                  setSelectedReportPeriod(null);
                  setAvgFrom(null);
                  setAvgTo(null);
                  setCurrentAvgFrom(null);
                  setCurrentAvgTo(null);
                }}
                className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Reset
              </button>
            )}
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Avg Live AUM from</span>
            <input
              type="date"
              value={currentAvgFrom ?? adjustments.data?.currentAvgFrom ?? ""}
              min={adjustments.data?.minSnapshotDate ?? undefined}
              max={adjustments.data?.maxSnapshotDate ?? undefined}
              onChange={(e) => setCurrentAvgFrom(e.target.value || null)}
              className={dateInputClass}
            />
            <span className="text-muted-foreground">to</span>
            <input
              type="date"
              value={currentAvgTo ?? adjustments.data?.currentAvgTo ?? ""}
              min={currentAvgFrom ?? adjustments.data?.minSnapshotDate ?? undefined}
              max={adjustments.data?.maxSnapshotDate ?? undefined}
              onChange={(e) => setCurrentAvgTo(e.target.value || null)}
              className={dateInputClass}
            />
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            &quot;Avg Live AUM&quot; defaults to the current fiscal quarter to date ({currentAvgWindowLabel}), and
            &quot;Avg AUM&quot; defaults to the previous fiscal quarter ({avgWindowLabel}) — both independently
            adjustable above. &quot;Avg AUM QoQ Change&quot; divides the two. Both total rows&apos;
            Holdings/Debt/Live Priced counts are de-duplicated by stock (a stock held by several
            AMCs counts once, not once per AMC) — the &quot;Industry Total&quot; row always across
            all 56 AMCs, unaffected by the Top-N selector or search, and the row above it across
            whichever AMCs are currently shown instead, so it can never exceed the industry figure.
          </p>
          <AmcTable
            amcs={filteredAmcs}
            allAmcs={adjustedAmcs}
            isSearchActive={query.trim() !== ""}
            topN={topN}
            reportPeriod={data.reportPeriod}
            reportedAumPeriodLabel={reportedAumPeriodLabel}
            avgWindowLabel={avgWindowLabel}
            currentAvgWindowLabel={currentAvgWindowLabel}
            asOfDate={data.asOfDate ?? null}
            distinctHoldingsCount={data.distinctHoldingsCount}
            distinctDebtInstrumentCount={data.distinctDebtInstrumentCount}
            distinctLivePricedCount={data.distinctLivePricedCount}
          />
          {filteredAmcs.length === 0 && (
            <p className="mt-4 text-center text-sm text-muted-foreground">No AMCs match &quot;{query}&quot;.</p>
          )}
        </TabsContent>
        <TabsContent value="aum-growth">
          <AumGrowthTable topN={topN} />
        </TabsContent>
        <TabsContent value="total-aum-growth">
          <TotalAumGrowthTable topN={topN} />
        </TabsContent>
        <TabsContent value="cash-holdings">
          <CashHoldingsTable topN={topN} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
