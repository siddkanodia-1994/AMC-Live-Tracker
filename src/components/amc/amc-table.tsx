"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MarketStatusBadge } from "@/components/layout/market-status-badge";
import { useRegisterExport } from "@/components/layout/export-context";
import { formatCr, formatDeltaCr, formatPct, formatReportPeriodLabel, formatShortDate } from "@/lib/utils/format";
import type { TopNOption } from "@/lib/utils/top-n";
import type { AmcLiveAum } from "@/lib/aum/types";

type SortKey =
  | "overviewName"
  | "liveAumCr"
  | "oneDayChangePct"
  | "reportedAumCr"
  | "deltaPct"
  | "currentQuarterAvgLiveAumCr"
  | "avgLiveAumCr"
  | "avgAumQoQChangePct"
  | "holdingsCount"
  | "debtInstrumentCount"
  | "livePricedCount"
  | "netFlowCr"
  | "netFlowPct";

const NET_FLOW_TITLE =
  "Reported AUM minus what AUM would be if the prior period's holdings had simply been repriced through this month-end (no trading), divided by the prior period's reported AUM. Conflates investor subscriptions/redemptions with the manager's own buying/selling — an approximation, not a pure flows figure. Blank until a prior period + its daily-snapshot backfill exist. Same denominator as the AUM Growth tab's Net Flow %, so both show the same percentage for the same underlying flow amount.";

function PctCell({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return <TableCell className="text-right tabular-nums">—</TableCell>;
  }
  return (
    <TableCell className="text-right tabular-nums">
      <span className={value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
        {formatPct(value, { alwaysSign: true })}
      </span>
    </TableCell>
  );
}

function DeltaCrCell({ value }: { value: number | null }) {
  if (value === null) {
    return <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>;
  }
  return (
    <TableCell className="text-right tabular-nums">
      <span className={value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
        {formatDeltaCr(value)}
      </span>
    </TableCell>
  );
}

function SortableHead({
  label,
  sublabel,
  sublabelAccent = true,
  sk,
  sortKey,
  sortDesc,
  onToggle,
  title,
}: {
  label: string;
  sublabel?: string;
  // false for a sublabel that's just a second line of static text (e.g.
  // "QoQ Change"), not a dynamic date/value -- accent-coloring it would
  // falsely imply it's a resolved variable like the other two-tier headers.
  sublabelAccent?: boolean;
  sk: SortKey;
  sortKey: SortKey;
  sortDesc: boolean;
  onToggle: (key: SortKey) => void;
  title?: string;
}) {
  const active = sk === sortKey;
  return (
    <TableHead
      className={`text-right first:text-left align-bottom ${sublabel ? "whitespace-normal" : ""}`}
      title={title}
    >
      <button type="button" onClick={() => onToggle(sk)} className="hover:text-foreground">
        {label}
        {active ? (sortDesc ? " ↓" : " ↑") : ""}
        {sublabel && (
          <span className={`block font-bold ${sublabelAccent ? "text-[var(--toolbar-accent)]" : "text-foreground"}`}>
            {sublabel}
          </span>
        )}
      </button>
    </TableHead>
  );
}

interface Totals {
  totalLiveAumCr: number;
  totalAvgAumCr: number;
  totalCurrentQuarterAvgAumCr: number;
  totalAvgAumQoQChangePct: number | null;
  totalReportedAumCr: number;
  totalLiveVsReportedPct: number | null;
  totalOneDayChangePct: number | null;
  totalHoldingsCount: number;
  totalDebtInstrumentCount: number;
  totalLivePricedCount: number;
  totalNetFlowCr: number | null;
  totalNetFlowPct: number | null;
}

function computeTotals(list: AmcLiveAum[]): Totals {
  const totalLiveAumCr = list.reduce((sum, a) => sum + a.liveAumCr, 0);
  const totalAvgAumCr = list.reduce((sum, a) => sum + (a.avgLiveAumCr ?? a.reportedAumCr), 0);
  const totalCurrentQuarterAvgAumCr = list.reduce((sum, a) => sum + (a.currentQuarterAvgLiveAumCr ?? a.reportedAumCr), 0);
  const totalAvgAumQoQChangePct = totalAvgAumCr !== 0 ? totalCurrentQuarterAvgAumCr / totalAvgAumCr - 1 : null;
  const totalReportedAumCr = list.reduce((sum, a) => sum + a.reportedAumCr, 0);
  const totalLiveVsReportedPct = totalReportedAumCr !== 0 ? totalLiveAumCr / totalReportedAumCr - 1 : null;

  // Only over AMCs with a known previous-day value, so one AMC missing
  // history doesn't skew the total's 1-day change.
  const withPrevDay = list.filter((a) => a.previousDayLiveAumCr !== null);
  const totalLiveAumCrWithPrevDay = withPrevDay.reduce((sum, a) => sum + a.liveAumCr, 0);
  const totalPreviousDayLiveAumCr = withPrevDay.reduce((sum, a) => sum + (a.previousDayLiveAumCr ?? 0), 0);
  const totalOneDayChangePct =
    totalPreviousDayLiveAumCr !== 0 ? totalLiveAumCrWithPrevDay / totalPreviousDayLiveAumCr - 1 : null;

  // Only over AMCs with a known net-flow baseline, so AMCs without a prior
  // period + backfill (e.g. brand-new funds) don't skew the total. null (not
  // 0) when nobody has data yet, so the footer shows "—" rather than a
  // misleading "zero flow".
  const withNetFlow = list.filter((a) => a.netFlowCr !== null && a.netFlowPriorPeriodReportedAumCr !== null);
  const totalNetFlowCr = withNetFlow.length > 0 ? withNetFlow.reduce((sum, a) => sum + (a.netFlowCr ?? 0), 0) : null;
  const totalNetFlowPriorPeriodReportedAumCr = withNetFlow.reduce((sum, a) => sum + (a.netFlowPriorPeriodReportedAumCr ?? 0), 0);
  const totalNetFlowPct =
    totalNetFlowCr !== null && totalNetFlowPriorPeriodReportedAumCr !== 0
      ? totalNetFlowCr / totalNetFlowPriorPeriodReportedAumCr
      : null;

  return {
    totalLiveAumCr,
    totalAvgAumCr,
    totalCurrentQuarterAvgAumCr,
    totalAvgAumQoQChangePct,
    totalReportedAumCr,
    totalLiveVsReportedPct,
    totalOneDayChangePct,
    // Distinct across the shown AMCs, not summed -- a stock held by several
    // of them counts once, matching how the Industry Total row already
    // counts industry-wide (see LiveAumSnapshot.distinctHoldingsCount).
    totalHoldingsCount: new Set(list.flatMap((a) => a.distinctHoldingIsins)).size,
    totalDebtInstrumentCount: new Set(list.flatMap((a) => a.distinctDebtKeys)).size,
    totalLivePricedCount: new Set(list.flatMap((a) => a.distinctLivePricedIsins)).size,
    totalNetFlowCr,
    totalNetFlowPct,
  };
}

function TotalsRow({
  label,
  totals,
  holdingsTitle,
  historical,
  showNetFlow,
}: {
  label: string;
  totals: Totals;
  holdingsTitle?: string;
  historical: boolean;
  showNetFlow: boolean;
}) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCr(totals.totalLiveAumCr)}</TableCell>
      <PctCell value={totals.totalOneDayChangePct} />
      <TableCell className="text-right tabular-nums">{formatCr(totals.totalReportedAumCr)}</TableCell>
      <PctCell value={totals.totalLiveVsReportedPct} />
      <TableCell className="text-right tabular-nums">{historical ? "—" : formatCr(totals.totalCurrentQuarterAvgAumCr)}</TableCell>
      <TableCell className="text-right tabular-nums">{historical ? "—" : formatCr(totals.totalAvgAumCr)}</TableCell>
      <PctCell value={historical ? null : totals.totalAvgAumQoQChangePct} />
      <TableCell className="text-right tabular-nums" title={holdingsTitle}>
        {historical ? "—" : totals.totalHoldingsCount}
      </TableCell>
      <TableCell className="text-right tabular-nums" title={holdingsTitle}>
        {historical ? "—" : totals.totalDebtInstrumentCount}
      </TableCell>
      <TableCell className="text-right tabular-nums" title={holdingsTitle}>
        {historical ? "—" : totals.totalLivePricedCount}
      </TableCell>
      {showNetFlow && (
        <>
          <DeltaCrCell value={totals.totalNetFlowCr} />
          <PctCell value={totals.totalNetFlowPct} />
        </>
      )}
    </TableRow>
  );
}

export function AmcTable({
  amcs,
  allAmcs,
  isSearchActive,
  topN,
  reportPeriod,
  reportedColumnLabel,
  reportedColumnSublabel,
  liveVsColumnLabel,
  avgWindowLabel,
  currentAvgWindowLabel,
  asOfDate,
  distinctHoldingsCount,
  distinctDebtInstrumentCount,
  distinctLivePricedCount,
}: {
  amcs: AmcLiveAum[];
  allAmcs: AmcLiveAum[];
  isSearchActive: boolean;
  topN: TopNOption;
  // Drives "Est. Net Flow" headers/export only -- always the CURRENT report
  // period, unaffected by the Reported AUM month picker (Net Flow is a
  // separate metric that isn't part of that adjustment).
  reportPeriod: string;
  // "Reported AUM"/"Hist. Live AUM" column's label + sublabel, and the
  // adjacent "Live vs Reported"/"Live vs Historical" column's label --
  // all three swap together with the Overview toolbar's AUM Basis toggle.
  // The underlying amc.reportedAumCr/deltaPct values are already resolved
  // to the right source upstream (amc-grid.tsx) -- these three props are
  // display-only.
  reportedColumnLabel: string;
  reportedColumnSublabel: string;
  liveVsColumnLabel: string;
  // "Avg AUM" column's window -- defaults to the previous fiscal quarter.
  avgWindowLabel: string;
  // "Avg Live AUM" column's window -- defaults to the current fiscal
  // quarter to date. Independent picker from avgWindowLabel above.
  currentAvgWindowLabel: string;
  asOfDate: string | null;
  distinctHoldingsCount: number;
  distinctDebtInstrumentCount: number;
  distinctLivePricedCount: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("liveAumCr");
  const [sortDesc, setSortDesc] = useState(true);
  // Hidden by default so the rest of the table can use a larger base font --
  // these 2 columns are the ones that force everything else to shrink to fit.
  const [showNetFlow, setShowNetFlow] = useState(false);

  // Top-N is always by Live AUM specifically, independent of whatever column
  // the table is currently sorted by for display — and skipped entirely
  // while a search is active, so searching always finds its target
  // regardless of the AMC's size/rank.
  const limited = useMemo(() => {
    if (isSearchActive || topN === "all") return amcs;
    return [...amcs].sort((a, b) => b.liveAumCr - a.liveAumCr).slice(0, topN);
  }, [amcs, topN, isSearchActive]);

  const sorted = useMemo(() => {
    const list = [...limited];
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [limited, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  function toggleNetFlowColumns() {
    setShowNetFlow((shown) => {
      const next = !shown;
      // Never leave the table sorted by a column that's about to be hidden.
      if (!next && (sortKey === "netFlowCr" || sortKey === "netFlowPct")) {
        setSortKey("liveAumCr");
        setSortDesc(true);
      }
      return next;
    });
  }

  const headProps = { sortKey, sortDesc, onToggle: toggleSort };
  const periodLabel = formatReportPeriodLabel(reportPeriod);
  const historical = asOfDate !== null;
  const liveAumLabel = asOfDate ? `Live AUM (${formatShortDate(asOfDate)})` : "Live AUM";

  useRegisterExport(() => ({
    fileName: `overview-${asOfDate ?? new Date().toISOString().slice(0, 10)}`,
    sheetName: "Overview",
    rows: sorted.map((amc) => ({
      AMC: amc.overviewName,
      [`${liveAumLabel} (Cr)`]: amc.liveAumCr,
      "1D Change (%)": amc.oneDayChangePct !== null ? amc.oneDayChangePct * 100 : null,
      [`${reportedColumnLabel} ${reportedColumnSublabel} (Cr)`]: amc.reportedAumCr,
      [`${liveVsColumnLabel} (%)`]: amc.deltaPct * 100,
      [`Avg Live AUM (${currentAvgWindowLabel}) (Cr)`]: historical ? null : (amc.currentQuarterAvgLiveAumCr ?? null),
      [`Avg AUM (${avgWindowLabel}) (Cr)`]: historical ? null : amc.avgLiveAumCr,
      "Avg AUM QoQ Change (%)": !historical && amc.avgAumQoQChangePct != null ? amc.avgAumQoQChangePct * 100 : null,
      Holdings: historical ? null : amc.holdingsCount,
      Debt: historical ? null : amc.debtInstrumentCount,
      "Live Priced": historical ? null : amc.livePricedCount,
      [`Est. Net Flow ${periodLabel} (Cr)`]: amc.netFlowCr,
      [`Est. Net Flow ${periodLabel} (%)`]: amc.netFlowPct !== null ? amc.netFlowPct * 100 : null,
    })),
  }));

  const subsetTotals = computeTotals(limited);
  const industryTotals = computeTotals(allAmcs);

  const isRestricted = isSearchActive || topN !== "all";
  const subsetLabel = isSearchActive
    ? `Total (${limited.length} matching AMC${limited.length === 1 ? "" : "s"})`
    : topN === "all"
      ? `Total (all ${allAmcs.length} AMCs)`
      : `Total (Top ${topN} of ${allAmcs.length} AMCs)`;
  const subsetHoldingsTitle = "Sum across these AMCs — not de-duplicated by stock, unlike the industry total row below";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {isSearchActive && "Showing all matches — the Top-N selector above is ignored while searching"}
        </p>
        <button
          type="button"
          onClick={toggleNetFlowColumns}
          className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {showNetFlow ? "Hide Est. Net Flow columns" : "+ Show Est. Net Flow columns"}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table className={showNetFlow ? "text-sm" : "text-base"}>
          <TableHeader>
            <TableRow>
              <TableHead className="align-bottom">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleSort("overviewName")}
                    className="hover:text-foreground"
                  >
                    AMC
                    {sortKey === "overviewName" ? (sortDesc ? " ↓" : " ↑") : ""}
                  </button>
                  <MarketStatusBadge />
                </div>
              </TableHead>
              <SortableHead
                label="Live AUM"
                sublabel={asOfDate ? formatShortDate(asOfDate) : undefined}
                sk="liveAumCr"
                {...headProps}
              />
              <SortableHead label="1D Change" sk="oneDayChangePct" {...headProps} />
              <SortableHead label={reportedColumnLabel} sublabel={reportedColumnSublabel} sk="reportedAumCr" {...headProps} />
              <SortableHead label={liveVsColumnLabel} sk="deltaPct" {...headProps} />
              <SortableHead
                label="Avg Live AUM"
                sublabel={currentAvgWindowLabel}
                sk="currentQuarterAvgLiveAumCr"
                {...headProps}
              />
              <SortableHead label="Avg AUM" sublabel={avgWindowLabel} sk="avgLiveAumCr" {...headProps} />
              <SortableHead
                label="Avg AUM"
                sublabel="QoQ Change"
                sublabelAccent={false}
                sk="avgAumQoQChangePct"
                {...headProps}
              />
              <SortableHead label="Holdings" sk="holdingsCount" {...headProps} />
              <SortableHead label="Debt" sk="debtInstrumentCount" {...headProps} />
              <SortableHead label="Live Priced" sk="livePricedCount" {...headProps} />
              {showNetFlow && (
                <>
                  <SortableHead
                    label="Est. Net Flow Cr"
                    sublabel={periodLabel}
                    sk="netFlowCr"
                    {...headProps}
                    title={NET_FLOW_TITLE}
                  />
                  <SortableHead
                    label="Est. Net Flow %"
                    sublabel={periodLabel}
                    sk="netFlowPct"
                    {...headProps}
                    title={NET_FLOW_TITLE}
                  />
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((amc) => (
              <TableRow key={amc.amcId}>
                <TableCell className="font-serif font-medium">
                  <Link href={`/amc/${amc.slug}`} className="hover:underline">
                    {amc.overviewName}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatCr(amc.liveAumCr)}</TableCell>
                <PctCell value={amc.oneDayChangePct} />
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatCr(amc.reportedAumCr)}
                </TableCell>
                <PctCell value={amc.deltaPct} />
                <TableCell className="text-right tabular-nums">
                  {amc.currentQuarterAvgLiveAumCr != null ? formatCr(amc.currentQuarterAvgLiveAumCr) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {amc.avgLiveAumCr !== null ? formatCr(amc.avgLiveAumCr) : "—"}
                </TableCell>
                <PctCell value={amc.avgAumQoQChangePct} />
                <TableCell className="text-right tabular-nums">{historical ? "—" : amc.holdingsCount}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {historical ? "—" : amc.debtInstrumentCount}
                </TableCell>
                <TableCell className="text-right tabular-nums">{historical ? "—" : amc.livePricedCount}</TableCell>
                {showNetFlow && (
                  <>
                    <DeltaCrCell value={amc.netFlowCr} />
                    <PctCell value={amc.netFlowPct} />
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TotalsRow
              label={subsetLabel}
              totals={subsetTotals}
              holdingsTitle={isRestricted ? subsetHoldingsTitle : undefined}
              historical={historical}
              showNetFlow={showNetFlow}
            />
            {isRestricted && (
              <TableRow className="text-muted-foreground">
                <TableCell>Industry Total (all {allAmcs.length} AMCs)</TableCell>
                <TableCell className="text-right tabular-nums">{formatCr(industryTotals.totalLiveAumCr)}</TableCell>
                <PctCell value={industryTotals.totalOneDayChangePct} />
                <TableCell className="text-right tabular-nums">{formatCr(industryTotals.totalReportedAumCr)}</TableCell>
                <PctCell value={industryTotals.totalLiveVsReportedPct} />
                <TableCell className="text-right tabular-nums">
                  {historical ? "—" : formatCr(industryTotals.totalCurrentQuarterAvgAumCr)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{historical ? "—" : formatCr(industryTotals.totalAvgAumCr)}</TableCell>
                <PctCell value={historical ? null : industryTotals.totalAvgAumQoQChangePct} />
                <TableCell className="text-right tabular-nums" title="Distinct stocks held anywhere in the industry — not a sum of each AMC's count">
                  {historical ? "—" : distinctHoldingsCount}
                </TableCell>
                <TableCell className="text-right tabular-nums" title="Distinct debt instruments (G-Secs, bank CDs/CPs) across the industry">
                  {historical ? "—" : distinctDebtInstrumentCount}
                </TableCell>
                <TableCell className="text-right tabular-nums" title="Distinct stocks currently showing a live price, industry-wide">
                  {historical ? "—" : distinctLivePricedCount}
                </TableCell>
                {showNetFlow && (
                  <>
                    <DeltaCrCell value={industryTotals.totalNetFlowCr} />
                    <PctCell value={industryTotals.totalNetFlowPct} />
                  </>
                )}
              </TableRow>
            )}
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
