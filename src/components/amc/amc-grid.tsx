"use client";

import { useMemo, useState } from "react";
import { useLiveAum } from "@/hooks/use-live-aum";
import { useOverviewAdjustments } from "@/hooks/use-overview-adjustments";
import { useCooldownRemainingMs } from "@/hooks/use-cooldown-remaining";
import { AmcTable } from "./amc-table";
import { FieldBox, WindowFieldBox } from "./field-box";
import { AumDeltaBadge } from "./aum-delta-badge";
import { FreshnessBadge } from "./freshness-badge";
import { AumGrowthTable } from "./aum-growth-table";
import { AumTrendChart } from "./aum-trend-chart";
import { TotalAumGrowthTable } from "./total-aum-growth-table";
import { CashHoldingsTable } from "@/components/cash-holdings/cash-holdings-table";
import { SectoralHoldingsTable } from "./sectoral-holdings-table";
import { StockTab } from "@/components/stock/stock-tab";
import { DailyDataTable } from "./daily-data-table";
import { MarketStatusBadge } from "@/components/layout/market-status-badge";
import { SearchBar } from "@/components/layout/search-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RelativeTime } from "@/components/ui/relative-time";
import { InfoIcon } from "lucide-react";
import { formatCr, formatDeltaCr, formatPct, formatReportPeriodLabel, formatShortDate } from "@/lib/utils/format";
import { DEFAULT_TOP_N, TOP_N_OPTIONS, type TopNOption } from "@/lib/utils/top-n";
import { LIVE_AUM_CACHE_TTL_MS } from "@/lib/utils/constants";
import { listFiscalQuarters } from "@/lib/aum/report-period";
import type { LiveAumSnapshot } from "@/lib/aum/types";
import type { AumHistoryPoint } from "@/lib/aum/history";

const CUSTOM_QUARTER_VALUE = "custom";

// The end date actually applied when a quarter is picked -- clamped to
// whatever data actually exists yet, so choosing the current in-progress
// quarter behaves as "quarter to date" instead of requesting a range that
// runs past today. Applies uniformly to both quarter dropdowns.
function clippedQuarterEnd(quarterEnd: string, maxSnapshotDate: string | null | undefined): string {
  return maxSnapshotDate && quarterEnd > maxSnapshotDate ? maxSnapshotDate : quarterEnd;
}

const DHAN_UNAVAILABLE_MESSAGE =
  "DHAN pricing is unavailable — every AMC below is showing last reported values. Check the DHAN token in Admin settings.";

const dateInputClass =
  "w-full min-w-0 rounded-md border bg-background px-2 py-1 text-sm hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

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
  // Lifted (rather than Tabs' own uncontrolled defaultValue) so the toolbar
  // panel below the tab bar can conditionally show the Overview-only field
  // boxes without duplicating tab-switch logic.
  const [activeTab, setActiveTab] = useState("overview");
  const { data, error, isLoading, mutate } = useLiveAum(initialData, asOfDate ?? undefined);
  // Shared by every refresh affordance on the page (the persistent button
  // outside the banner box, in whichever of its three states) -- no
  // `?refresh=1` bypass, so a click within LIVE_AUM_CACHE_TTL_MS of the last
  // real computation (anyone's poll or click) just re-shows the same
  // already-fresh prices instead of forcing a new DHAN call. See the plan's
  // "Key finding" for why this needs no new server-side cooldown state.
  const [isRefreshing, setIsRefreshing] = useState(false);
  async function refreshLivePrices() {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/live-aum");
      if (res.ok) {
        const fresh = await res.json();
        await mutate(fresh, { revalidate: false });
      }
    } finally {
      setIsRefreshing(false);
    }
  }
  const cooldownMs = useCooldownRemainingMs(data?.computedAt ?? new Date(0).toISOString(), LIVE_AUM_CACHE_TTL_MS);
  const isRefreshOnCooldown = cooldownMs > 0;

  const [isDismissing, setIsDismissing] = useState(false);
  async function dismissForToday() {
    setIsDismissing(true);
    try {
      const res = await fetch("/api/live-aum/dismiss-last-close", { method: "POST" });
      if (res.ok) {
        const fresh = await res.json();
        await mutate(fresh, { revalidate: false });
      }
    } finally {
      setIsDismissing(false);
    }
  }

  // Which stock's inline "Accept" reason form is currently open -- only one
  // at a time, matching the app's other single-active-editor UI patterns.
  const [acceptingIsin, setAcceptingIsin] = useState<string | null>(null);
  const [acceptReason, setAcceptReason] = useState("");
  const [isAccepting, setIsAccepting] = useState(false);
  async function acceptReasonFor(isin: string) {
    const reason = acceptReason.trim();
    if (!reason) return;
    setIsAccepting(true);
    try {
      const res = await fetch("/api/live-aum/mute-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isin, reason }),
      });
      if (res.ok) {
        const fresh = await res.json();
        await mutate(fresh, { revalidate: false });
        setAcceptingIsin(null);
        setAcceptReason("");
      }
    } finally {
      setIsAccepting(false);
    }
  }
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
  // "Reported AUM" column's basis: the officially reported figure for a
  // selected month, or each AMC's historical live (repriced) AUM as of an
  // arbitrary past date. Defaults to hist-live per product decision -- the
  // two modes keep independent state, so switching back and forth doesn't
  // lose either one's last selection.
  const [reportedAumMode, setReportedAumMode] = useState<"reported" | "hist-live">("hist-live");
  const [histLiveDate, setHistLiveDate] = useState<string | null>(null);
  // Manual disclosure for each window's custom from/to range -- forced open
  // whenever the underlying dates don't match any listed quarter (so a
  // genuinely custom window is never hidden behind a collapsed toggle).
  const [avgWindowExpanded, setAvgWindowExpanded] = useState(false);
  const [currentAvgWindowExpanded, setCurrentAvgWindowExpanded] = useState(false);
  const adjustments = useOverviewAdjustments(
    selectedReportPeriod ?? undefined,
    avgFrom ?? undefined,
    avgTo ?? undefined,
    currentAvgFrom ?? undefined,
    currentAvgTo ?? undefined,
    histLiveDate ?? undefined
  );
  // Every fiscal quarter with real data, oldest first -- powers the "Avg
  // AUM quarter"/"Avg Live AUM quarter" dropdowns. Derived entirely from the
  // server's own reported data bounds, so it grows on its own each quarter.
  const minSnapshotDate = adjustments.data?.minSnapshotDate;
  const maxSnapshotDate = adjustments.data?.maxSnapshotDate;
  const quarterOptions = useMemo(() => {
    if (!minSnapshotDate || !maxSnapshotDate) return [];
    return listFiscalQuarters(minSnapshotDate, maxSnapshotDate);
  }, [minSnapshotDate, maxSnapshotDate]);

  // Which quarter (if any) the given resolved from/to dates exactly match,
  // accounting for the same end-date clipping applied when a quarter is
  // picked -- so picking the current in-progress quarter round-trips back
  // to showing itself selected, not "Custom range".
  function matchingQuarterKey(resolvedFrom: string | undefined, resolvedTo: string | undefined): string {
    if (!resolvedFrom || !resolvedTo) return CUSTOM_QUARTER_VALUE;
    const match = quarterOptions.find(
      (q) => q.start === resolvedFrom && clippedQuarterEnd(q.end, maxSnapshotDate) === resolvedTo
    );
    return match?.key ?? CUSTOM_QUARTER_VALUE;
  }

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
      const reportedAumCr =
        reportedAumMode === "hist-live"
          ? (adj.histLiveAumByAmcId[amc.amcId] ?? amc.liveAumCr)
          : (adj.reportedAumByAmcId[amc.amcId] ?? amc.reportedAumCr);
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
  }, [data, adjustments.data, reportedAumMode]);

  const filteredAmcs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? adjustedAmcs.filter((a) => a.overviewName.toLowerCase().includes(q)) : adjustedAmcs;
  }, [adjustedAmcs, query]);

  // Card 1's comparison basis: industry-wide Live AUM as of the last day of
  // the previous calendar month (e.g. 30 Jun while viewing July), not
  // Reported AUM -- a month-to-date live-growth signal instead of a
  // live-vs-last-disclosed-figure divergence signal. Reuses
  // adjustments.data.histLiveAumByAmcId -- the EXACT same per-AMC data the
  // "Hist. Live AUM" column/toggle below already computes (defaults to
  // lastDayOfPreviousCalendarMonth server-side, see overview-adjustments.ts)
  // -- rather than a separate history-based lookup. That's not just fewer
  // moving parts: getIndustryAumHistory() sums ALL AMCs ever canonically
  // tracked on that date, including ones no longer in the current AMC
  // roster (confirmed: 5 SIFs merged/renamed away between May and June),
  // while histLiveAumByAmcId is scoped to TODAY's current AMC list with a
  // same-as-today fallback for any brand-new AMC with no history yet --
  // exactly matching the Overview table's own "Industry Total" row, which
  // is where this comparison figure needs to agree with what's already on
  // screen a few rows below it.
  // histLiveDate always defaults relative to REAL today, independent of
  // whatever asOfDate the Overview might be browsing (same as the "Hist.
  // Live AUM" column itself) -- in historical mode that could put the
  // comparison basis AFTER the day being viewed, which reads backwards. So
  // this badge just doesn't render in that mode, same treatment card 2
  // already gives its own "not available for historical dates" case.
  const lastMonthEndDate = data?.asOfDate ? null : (adjustments.data?.histLiveDate ?? null);
  const lastMonthEndLiveAumCr = useMemo(() => {
    if (!data || data.asOfDate || !adjustments.data) return null;
    const map = adjustments.data.histLiveAumByAmcId;
    return data.amcs.reduce((sum, amc) => sum + (map[amc.amcId] ?? amc.liveAumCr), 0);
  }, [data, adjustments.data]);

  const industryTotals = useMemo(() => {
    if (!data) return null;
    const totalAvgAumCr = data.amcs.reduce((sum, a) => sum + (a.avgLiveAumCr ?? a.reportedAumCr), 0);
    const liveDeltaCr = lastMonthEndLiveAumCr !== null ? data.totalLiveAumCr - lastMonthEndLiveAumCr : null;
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
    // Fixed rolling 90-calendar-day window (vs. the 90 days before that) --
    // same per-AMC-fallback-then-sum approach as totalAvgAumCr above, just
    // sourced from the two rolling-window fields instead of the
    // since-last-report one.
    const total90dAvgAumCr = data.amcs.reduce((sum, a) => sum + (a.avgLiveAumCr90d ?? a.reportedAumCr), 0);
    const totalPrev90dAvgAumCr = data.amcs.reduce((sum, a) => sum + (a.avgLiveAumCrPrev90d ?? a.reportedAumCr), 0);
    const avgDeltaCr90d = total90dAvgAumCr - totalPrev90dAvgAumCr;
    return {
      totalAvgAumCr,
      liveDeltaCr,
      liveDeltaPct:
        liveDeltaCr !== null && lastMonthEndLiveAumCr !== 0 && lastMonthEndLiveAumCr !== null
          ? liveDeltaCr / lastMonthEndLiveAumCr
          : null,
      avgDeltaCr,
      avgDeltaPct: data.totalReportedAumCr !== 0 ? avgDeltaCr / data.totalReportedAumCr : 0,
      total90dAvgAumCr,
      totalPrev90dAvgAumCr,
      avgDeltaCr90d,
      avgDeltaPct90d: totalPrev90dAvgAumCr !== 0 ? avgDeltaCr90d / totalPrev90dAvgAumCr : 0,
      totalPreviousDayLiveAumCr,
      oneDayChangeCr,
      oneDayChangePct: totalPreviousDayLiveAumCr !== 0 ? oneDayChangeCr / totalPreviousDayLiveAumCr : null,
    };
  }, [data, lastMonthEndLiveAumCr]);

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
  const lastCloseStocks = data.lastCloseStocks ?? [];
  const activeLastCloseStocks = lastCloseStocks.filter((s) => !s.autoMuted);
  const mutedLastCloseStocks = lastCloseStocks.filter((s) => s.autoMuted);
  const lastCloseCount = activeLastCloseStocks.length;
  const isLastCloseWarning = !data.dhanErrorDetail && data.dhanStatus !== "unavailable" && data.pricesAreLive && lastCloseCount > 0;
  const statusMessage = data.dhanErrorDetail
    ? `DHAN pricing issue: ${data.dhanErrorDetail}`
    : data.dhanStatus === "unavailable"
      ? DHAN_UNAVAILABLE_MESSAGE
      : isLastCloseWarning
        ? `${lastCloseCount} stock${lastCloseCount === 1 ? "" : "s"} that previously had live prices ${lastCloseCount === 1 ? "is" : "are"} no longer being priced live — showing their last close instead.`
        : null;
  const showMutedTrace = data.pricesAreLive && !data.dhanErrorDetail && data.dhanStatus !== "unavailable" && mutedLastCloseStocks.length > 0;
  // The persistent refresh control's label: "Check now" only while the
  // active amber warning is showing, "Refresh" in every other case
  // (dismissed, muted-only, or nothing flagged at all) -- one physical
  // button/cooldown, label depends on context (see plan's "Button count").
  const refreshLabel = isRefreshing
    ? "Checking…"
    : isRefreshOnCooldown
      ? `Refresh in ${Math.ceil(cooldownMs / 1000)}s`
      : isLastCloseWarning && !data.lastCloseDismissedToday
        ? "Check now"
        : "Refresh";

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
  // The "Reported AUM"/"Live vs Reported" columns' labels swap with the
  // AUM Basis toggle -- everything downstream (adjustedAmcs' reportedAumCr/
  // deltaPct) already resolves to the right values, this just relabels the
  // header to match.
  const reportedColumnLabel = reportedAumMode === "hist-live" ? "Hist. Live AUM" : "Reported AUM";
  const reportedColumnSublabel =
    reportedAumMode === "hist-live"
      ? formatShortDate(adjustments.data?.histLiveDate ?? histLiveDate ?? "")
      : reportedAumPeriodLabel;
  const liveVsColumnLabel = reportedAumMode === "hist-live" ? "Live vs Historical" : "Live vs Reported";
  const adjustmentsTouched =
    selectedReportPeriod !== null ||
    avgFrom !== null ||
    avgTo !== null ||
    currentAvgFrom !== null ||
    currentAvgTo !== null ||
    reportedAumMode !== "hist-live" ||
    histLiveDate !== null;

  // Each window's custom-range disclosure is forced open whenever its dates
  // don't match a listed quarter, in addition to whatever the user last
  // manually toggled -- so a genuinely custom window is never hidden.
  const avgQuarterKey = matchingQuarterKey(avgFrom ?? adjustments.data?.avgFrom, avgTo ?? adjustments.data?.avgTo);
  const avgWindowIsExpanded = avgWindowExpanded || avgQuarterKey === CUSTOM_QUARTER_VALUE;
  const currentAvgQuarterKey = matchingQuarterKey(
    currentAvgFrom ?? adjustments.data?.currentAvgFrom,
    currentAvgTo ?? adjustments.data?.currentAvgTo
  );
  const currentAvgWindowIsExpanded = currentAvgWindowExpanded || currentAvgQuarterKey === CUSTOM_QUARTER_VALUE;

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
              {industryTotals.liveDeltaCr !== null && industryTotals.liveDeltaPct !== null && (
                <AumDeltaBadge deltaCr={industryTotals.liveDeltaCr} deltaPct={industryTotals.liveDeltaPct} />
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {lastMonthEndDate !== null && lastMonthEndLiveAumCr !== null && (
                <>
                  vs {formatShortDate(lastMonthEndDate)}: {formatCr(lastMonthEndLiveAumCr)} ·{" "}
                </>
              )}
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
              Average Industry Equity AUM (last 90 days)
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
                  <div className="text-3xl font-semibold tabular-nums">{formatCr(industryTotals.total90dAvgAumCr)}</div>
                  <AumDeltaBadge deltaCr={industryTotals.avgDeltaCr90d} deltaPct={industryTotals.avgDeltaPct90d} />
                </div>
                <div className="text-xs text-muted-foreground">
                  Previous 90d avg: {formatCr(industryTotals.totalPrev90dAvgAumCr)}
                  {data.prev90Start && data.prev90End && data.last90Start && data.last90End && (
                    <>
                      {" "}
                      · {formatShortDate(data.prev90Start)} – {formatShortDate(data.prev90End)} vs{" "}
                      {formatShortDate(data.last90Start)} – {formatShortDate(data.last90End)}
                    </>
                  )}
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
      {!data.asOfDate && (
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            {isLastCloseWarning && !data.lastCloseDismissedToday ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{statusMessage}</span>
                  <button
                    type="button"
                    onClick={dismissForToday}
                    disabled={isDismissing}
                    className="rounded-md border border-amber-500/50 px-2 py-0.5 text-xs font-medium hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isDismissing ? "Ignoring…" : "Ignore for today"}
                  </button>
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer">
                    Show stock{activeLastCloseStocks.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {activeLastCloseStocks.map((s) => (
                      <li key={s.isin}>
                        {s.companyName}
                        {" — "}
                        {s.daysUnchanged === null
                          ? "no price history yet"
                          : `unchanged ${s.daysUnchanged} day${s.daysUnchanged === 1 ? "" : "s"}`}
                        {" · "}
                        {acceptingIsin === s.isin ? (
                          <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                            <input
                              type="text"
                              value={acceptReason}
                              onChange={(e) => setAcceptReason(e.target.value)}
                              placeholder="Known reason (e.g. amalgamated into X)"
                              className="rounded border border-amber-500/40 bg-background px-1.5 py-0.5 text-xs text-foreground"
                            />
                            <button
                              type="button"
                              onClick={() => acceptReasonFor(s.isin)}
                              disabled={isAccepting || !acceptReason.trim()}
                              className="rounded border border-amber-500/50 px-1.5 py-0.5 text-xs font-medium hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isAccepting ? "Saving…" : "Confirm"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAcceptingIsin(null);
                                setAcceptReason("");
                              }}
                              className="text-xs underline"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setAcceptingIsin(s.isin);
                              setAcceptReason("");
                            }}
                            className="text-xs underline"
                          >
                            Accept
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : isLastCloseWarning && data.lastCloseDismissedToday ? (
              <div className="text-sm text-muted-foreground">
                <span>
                  {lastCloseCount} stock{lastCloseCount === 1 ? "" : "s"} not live · Updated{" "}
                  <RelativeTime iso={data.computedAt} /> ago
                </span>
                <details className="mt-1">
                  <summary className="cursor-pointer">
                    Show stock{activeLastCloseStocks.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-1 list-disc pl-4">
                    {activeLastCloseStocks.map((s) => (
                      <li key={s.isin}>
                        {s.companyName}
                        {" — "}
                        {s.daysUnchanged === null
                          ? "no price history yet"
                          : `unchanged ${s.daysUnchanged} day${s.daysUnchanged === 1 ? "" : "s"}`}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            ) : statusMessage ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                {statusMessage}
              </div>
            ) : null}
            {showMutedTrace && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {mutedLastCloseStocks.length} stock{mutedLastCloseStocks.length === 1 ? "" : "s"} auto-muted
                </summary>
                <ul className="mt-1 list-disc pl-4">
                  {mutedLastCloseStocks.map((s) => (
                    <li key={s.isin}>
                      {s.companyName} — muted{s.muteReason ? `: ${s.muteReason}` : " (5+ day streak)"}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          <button
            type="button"
            onClick={refreshLivePrices}
            disabled={isRefreshing || isRefreshOnCooldown}
            className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshLabel}
          </button>
        </div>
      )}
      {data.dailyDataQualityAlert && (
        <button
          type="button"
          onClick={() => setActiveTab("daily-data")}
          className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-left text-sm text-red-700 hover:bg-red-500/15 dark:text-red-400"
        >
          {data.dailyDataQualityAlert.count} day{data.dailyDataQualityAlert.count === 1 ? "" : "s"} show DHAN price
          coverage below 80% (worst: {data.dailyDataQualityAlert.worstPct.toFixed(1)}%,{" "}
          {formatShortDate(data.dailyDataQualityAlert.worstDate)}) — see Daily Data tab →
        </button>
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

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as string)}>
        <div className="rounded-xl border bg-card p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-2.5">
            <TabsList variant="line">
              <TabsTrigger value="overview" className="after:bg-[var(--toolbar-accent)]">
                Overview
              </TabsTrigger>
              <TabsTrigger value="aum-growth" className="after:bg-[var(--toolbar-accent)]">
                Equity AUM Growth
              </TabsTrigger>
              <TabsTrigger value="total-aum-growth" className="after:bg-[var(--toolbar-accent)]">
                Total AUM Growth
              </TabsTrigger>
              <TabsTrigger value="sectoral-holdings" className="after:bg-[var(--toolbar-accent)]">
                Sectoral Holdings
              </TabsTrigger>
              <TabsTrigger value="cash-holdings" className="after:bg-[var(--toolbar-accent)]">
                Cash Holdings
              </TabsTrigger>
              <TabsTrigger value="stock" className="after:bg-[var(--toolbar-accent)]">
                Stock
              </TabsTrigger>
              <TabsTrigger value="daily-data" className="after:bg-[var(--toolbar-accent)]">
                Daily Data
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-3 text-sm">
              {activeTab === "overview" && <SearchBar value={query} onChange={setQuery} />}
              {activeTab !== "stock" && (
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Show:</span>
                  {TOP_N_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setTopN(option)}
                      className={`rounded-md px-2 py-1 ${
                        topN === option
                          ? "bg-[var(--toolbar-accent)] text-white"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {option === "all" ? "All" : `Top ${option}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {activeTab === "overview" && (
            <div className="flex flex-col gap-3 pt-3">
              <div>
                <p className="mb-1.5 text-[10px] font-bold tracking-wider text-[var(--toolbar-accent)] uppercase">
                  View basis
                </p>
                <div className="flex flex-wrap items-stretch gap-2.5">
                  <FieldBox label="Live AUM as of">
                    <input
                      type="date"
                      value={asOfDate ?? ""}
                      min={data.minSnapshotDate ?? undefined}
                      max={data.maxSnapshotDate ?? undefined}
                      onChange={(e) => setAsOfDate(e.target.value || null)}
                      className={dateInputClass}
                    />
                  </FieldBox>
                  <div className="flex flex-wrap items-center gap-2 self-center text-sm">
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

                  <FieldBox label="AUM Basis">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setReportedAumMode("reported")}
                        className={`rounded-md px-2 py-1 text-sm ${
                          reportedAumMode === "reported"
                            ? "bg-[var(--toolbar-accent)] text-white"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Reported AUM
                      </button>
                      <button
                        type="button"
                        onClick={() => setReportedAumMode("hist-live")}
                        className={`rounded-md px-2 py-1 text-sm ${
                          reportedAumMode === "hist-live"
                            ? "bg-[var(--toolbar-accent)] text-white"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        Hist. Live AUM
                      </button>
                    </div>
                  </FieldBox>

                  <FieldBox label={reportedAumMode === "hist-live" ? "Hist. Live AUM date" : "Reported AUM month"}>
                    {reportedAumMode === "hist-live" ? (
                      <input
                        type="date"
                        value={histLiveDate ?? adjustments.data?.histLiveDate ?? ""}
                        min={adjustments.data?.minSnapshotDate ?? undefined}
                        max={adjustments.data?.maxSnapshotDate ?? undefined}
                        onChange={(e) => setHistLiveDate(e.target.value || null)}
                        className={dateInputClass}
                      />
                    ) : (
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
                    )}
                  </FieldBox>
                </div>
              </div>

              <div className="border-t pt-3">
                <p className="mb-1.5 text-[10px] font-bold tracking-wider text-[var(--toolbar-accent)] uppercase">
                  Averaging windows
                </p>
                <div className="flex flex-wrap items-stretch gap-2.5">
                  <WindowFieldBox
                    label="Avg AUM window"
                    expanded={avgWindowIsExpanded}
                    onToggleExpanded={() => setAvgWindowExpanded((v) => !v)}
                  >
                    <select
                      value={avgQuarterKey}
                      onChange={(e) => {
                        const quarter = quarterOptions.find((q) => q.key === e.target.value);
                        if (!quarter) return;
                        setAvgFrom(quarter.start);
                        setAvgTo(clippedQuarterEnd(quarter.end, maxSnapshotDate));
                      }}
                      className={dateInputClass}
                    >
                      <option value={CUSTOM_QUARTER_VALUE}>Custom range</option>
                      {quarterOptions.map((q) => (
                        <option key={q.key} value={q.key}>
                          {q.label}
                        </option>
                      ))}
                    </select>
                    {avgWindowIsExpanded && (
                      <div className="flex items-center gap-1.5 pt-1">
                        <input
                          type="date"
                          value={avgFrom ?? adjustments.data?.avgFrom ?? ""}
                          min={adjustments.data?.minSnapshotDate ?? undefined}
                          max={adjustments.data?.maxSnapshotDate ?? undefined}
                          onChange={(e) => setAvgFrom(e.target.value || null)}
                          className={dateInputClass}
                        />
                        <span className="text-xs text-muted-foreground">to</span>
                        <input
                          type="date"
                          value={avgTo ?? adjustments.data?.avgTo ?? ""}
                          min={avgFrom ?? adjustments.data?.minSnapshotDate ?? undefined}
                          max={adjustments.data?.maxSnapshotDate ?? undefined}
                          onChange={(e) => setAvgTo(e.target.value || null)}
                          className={dateInputClass}
                        />
                      </div>
                    )}
                  </WindowFieldBox>

                  <WindowFieldBox
                    label="Avg Live AUM window"
                    expanded={currentAvgWindowIsExpanded}
                    onToggleExpanded={() => setCurrentAvgWindowExpanded((v) => !v)}
                  >
                    <select
                      value={currentAvgQuarterKey}
                      onChange={(e) => {
                        const quarter = quarterOptions.find((q) => q.key === e.target.value);
                        if (!quarter) return;
                        setCurrentAvgFrom(quarter.start);
                        setCurrentAvgTo(clippedQuarterEnd(quarter.end, maxSnapshotDate));
                      }}
                      className={dateInputClass}
                    >
                      <option value={CUSTOM_QUARTER_VALUE}>Custom range</option>
                      {quarterOptions.map((q) => (
                        <option key={q.key} value={q.key}>
                          {q.label}
                        </option>
                      ))}
                    </select>
                    {currentAvgWindowIsExpanded && (
                      <div className="flex items-center gap-1.5 pt-1">
                        <input
                          type="date"
                          value={currentAvgFrom ?? adjustments.data?.currentAvgFrom ?? ""}
                          min={adjustments.data?.minSnapshotDate ?? undefined}
                          max={adjustments.data?.maxSnapshotDate ?? undefined}
                          onChange={(e) => setCurrentAvgFrom(e.target.value || null)}
                          className={dateInputClass}
                        />
                        <span className="text-xs text-muted-foreground">to</span>
                        <input
                          type="date"
                          value={currentAvgTo ?? adjustments.data?.currentAvgTo ?? ""}
                          min={currentAvgFrom ?? adjustments.data?.minSnapshotDate ?? undefined}
                          max={adjustments.data?.maxSnapshotDate ?? undefined}
                          onChange={(e) => setCurrentAvgTo(e.target.value || null)}
                          className={dateInputClass}
                        />
                      </div>
                    )}
                  </WindowFieldBox>

                  <div className="flex items-center gap-1 self-center">
                    {adjustmentsTouched && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReportPeriod(null);
                          setAvgFrom(null);
                          setAvgTo(null);
                          setCurrentAvgFrom(null);
                          setCurrentAvgTo(null);
                          setReportedAumMode("hist-live");
                          setHistLiveDate(null);
                          setAvgWindowExpanded(false);
                          setCurrentAvgWindowExpanded(false);
                        }}
                        className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Reset
                      </button>
                    )}
                    <Tooltip>
                  <TooltipTrigger className="rounded-md p-1.5 text-muted-foreground hover:text-foreground">
                    <InfoIcon className="size-4" />
                    <span className="sr-only">About these AUM windows</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    &quot;Avg Live AUM&quot; defaults to the current fiscal quarter to date (
                    {currentAvgWindowLabel}), and &quot;Avg AUM&quot; defaults to the previous fiscal quarter (
                    {avgWindowLabel}) — both independently adjustable above. &quot;Avg AUM QoQ Change&quot; divides
                    the two. Both total rows&apos; Holdings/Debt/Live Priced counts are de-duplicated by stock (a
                    stock held by several AMCs counts once, not once per AMC) — the &quot;Industry Total&quot; row
                    always across all 56 AMCs, unaffected by the Top-N selector or search, and the row above it
                    across whichever AMCs are currently shown instead, so it can never exceed the industry figure.
                  </TooltipContent>
                </Tooltip>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <TabsContent value="overview">
          <AmcTable
            amcs={filteredAmcs}
            allAmcs={adjustedAmcs}
            isSearchActive={query.trim() !== ""}
            topN={topN}
            reportPeriod={data.reportPeriod}
            reportedColumnLabel={reportedColumnLabel}
            reportedColumnSublabel={reportedColumnSublabel}
            liveVsColumnLabel={liveVsColumnLabel}
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
        <TabsContent value="sectoral-holdings">
          <SectoralHoldingsTable topN={topN} />
        </TabsContent>
        <TabsContent value="cash-holdings">
          <CashHoldingsTable topN={topN} />
        </TabsContent>
        <TabsContent value="stock">
          <StockTab />
        </TabsContent>
        <TabsContent value="daily-data">
          <DailyDataTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
