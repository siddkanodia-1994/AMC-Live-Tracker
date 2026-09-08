"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MarketStatusBadge } from "@/components/layout/market-status-badge";
import { useRegisterExport } from "@/components/layout/export-context";
import { formatCr, formatDeltaCr, formatIndexLevel, formatPct, formatReportPeriodLabel, formatShortDate } from "@/lib/utils/format";
import type { TopNOption } from "@/lib/utils/top-n";
import type { AmcLiveAum, IndexBenchmarkRow } from "@/lib/aum/types";

type SortKey =
  | "overviewName"
  | "liveAumCr"
  | "oneDayChangePct"
  | "reportedAumCr"
  | "deltaPct"
  | "currentQuarterAvgLiveAumCr"
  | "avgLiveAumCr"
  | "avgAumQoQChangePct"
  | "avgLiveAumCrCombined"
  | "avgAumCrCombined"
  | "avgAumQoQChangePctCombined"
  | "holdingsCount"
  | "debtInstrumentCount"
  | "livePricedCount"
  | "netFlowCr"
  | "netFlowPct";

// Not real fields on AmcLiveAum -- derived on the fly from an AMC's own
// avgLiveAumCr/currentQuarterAvgLiveAumCr plus its Gold+Silver ETF total
// (looked up by overviewName, since etf_schemes.amc is seeded to match that
// string exactly). Same ETF figure is added to both columns because ETFs
// have no daily AUM history to distinguish "this quarter" vs "previous
// quarter" the way equity's rolling windows do -- see the plan's audit.
// This necessarily dampens the resulting QoQ% vs the equity-only one
// (adding the same constant to numerator and denominator pulls the ratio
// toward 1), which is expected, not a bug.
function combinedAvgFigures(amc: AmcLiveAum, etfTotalsByAmc: Record<string, number>) {
  const etfTotal = etfTotalsByAmc[amc.overviewName] ?? 0;
  const avgLiveAumCrCombined = amc.currentQuarterAvgLiveAumCr != null ? amc.currentQuarterAvgLiveAumCr + etfTotal : null;
  const avgAumCrCombined = amc.avgLiveAumCr != null ? amc.avgLiveAumCr + etfTotal : null;
  const avgAumQoQChangePctCombined =
    avgLiveAumCrCombined != null && avgAumCrCombined != null && avgAumCrCombined !== 0
      ? avgLiveAumCrCombined / avgAumCrCombined - 1
      : null;
  return { etfTotal, avgLiveAumCrCombined, avgAumCrCombined, avgAumQoQChangePctCombined };
}

const COMBINED_SORT_KEYS: SortKey[] = ["avgLiveAumCrCombined", "avgAumCrCombined", "avgAumQoQChangePctCombined"];

function sortValue(
  amc: AmcLiveAum,
  key: SortKey,
  etfTotalsByAmc: Record<string, number>
): number | string | null | undefined {
  if (COMBINED_SORT_KEYS.includes(key)) {
    const combined = combinedAvgFigures(amc, etfTotalsByAmc);
    if (key === "avgLiveAumCrCombined") return combined.avgLiveAumCrCombined;
    if (key === "avgAumCrCombined") return combined.avgAumCrCombined;
    return combined.avgAumQoQChangePctCombined;
  }
  return amc[key as keyof AmcLiveAum] as number | string | null | undefined;
}

// Subtle teal tint on every "+ Gold/Silver" cell -- distinguishes the new,
// combined group from the equity-only "Avg AUM Growth" group (blue) at a
// glance, using the same --toolbar-accent color as the rest of the app's
// active-state accents rather than introducing a new hue.
const GS_CELL_CLASS = "bg-[var(--toolbar-accent)]/[0.06]";

const GOLD_SILVER_TITLE =
  "Adds each AMC's Total (Gold+Silver) Reported AUM — from the Gold & Silver ETFs tab, AMFI's own latest disclosed quarterly average — onto both equity averaging columns equally, then recomputes QoQ Change from the combined figures. Since ETFs have no daily AUM history, the same ETF figure is added to both the current-quarter and previous-quarter columns, which dampens the resulting QoQ Change versus the equity-only figure. An AMC with no Gold/Silver ETF is unaffected.";

// Structural separator between the table's three column groups (Avg AUM
// Growth / Exit AUM Growth / Portfolio) -- applied at every row type
// (group-header, column-header, body, both footer rows) so each reads as
// one continuous divider running the full table height, not just a header
// decoration. Thin/low-opacity deliberately: with three groups now, two of
// these run at once, and a heavier rule at every boundary starts to look
// like a grid rather than a soft grouping cue.
const GROUP_DIVIDER_CLASS = "border-r border-blue-900/20 dark:border-blue-300/20";

const NET_FLOW_TITLE =
  "Reported AUM minus what AUM would be if the prior period's holdings had simply been repriced through this month-end (no trading), divided by the prior period's reported AUM. Conflates investor subscriptions/redemptions with the manager's own buying/selling — an approximation, not a pure flows figure. Blank until a prior period + its daily-snapshot backfill exist. Same denominator as the AUM Growth tab's Net Flow %, so both show the same percentage for the same underlying flow amount.";

function PctCell({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) {
    return <TableCell className={`text-right tabular-nums ${className}`}>—</TableCell>;
  }
  return (
    <TableCell className={`text-right tabular-nums ${className}`}>
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
  className = "",
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
  className?: string;
}) {
  const active = sk === sortKey;
  return (
    <TableHead
      className={`text-right first:text-left align-bottom ${sublabel ? "whitespace-normal" : ""} ${className}`}
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
  totalAvgAumCrCombined: number;
  totalCurrentQuarterAvgAumCrCombined: number;
  totalAvgAumQoQChangePctCombined: number | null;
  totalReportedAumCr: number;
  totalLiveVsReportedPct: number | null;
  totalOneDayChangePct: number | null;
  totalHoldingsCount: number;
  totalDebtInstrumentCount: number;
  totalLivePricedCount: number;
  totalNetFlowCr: number | null;
  totalNetFlowPct: number | null;
}

function computeTotals(list: AmcLiveAum[], etfTotalsByAmc: Record<string, number>): Totals {
  const totalLiveAumCr = list.reduce((sum, a) => sum + a.liveAumCr, 0);
  const totalAvgAumCr = list.reduce((sum, a) => sum + (a.avgLiveAumCr ?? a.reportedAumCr), 0);
  const totalCurrentQuarterAvgAumCr = list.reduce((sum, a) => sum + (a.currentQuarterAvgLiveAumCr ?? a.reportedAumCr), 0);
  const totalAvgAumQoQChangePct = totalAvgAumCr !== 0 ? totalCurrentQuarterAvgAumCr / totalAvgAumCr - 1 : null;
  // Sum the combined (equity + Gold/Silver) per-AMC figures first, THEN
  // divide -- never sum each AMC's own already-computed combined QoQ%,
  // which would double-weight AMCs with a small denominator.
  const totalEtfTotal = list.reduce((sum, a) => sum + (etfTotalsByAmc[a.overviewName] ?? 0), 0);
  const totalAvgAumCrCombined = totalAvgAumCr + totalEtfTotal;
  const totalCurrentQuarterAvgAumCrCombined = totalCurrentQuarterAvgAumCr + totalEtfTotal;
  const totalAvgAumQoQChangePctCombined =
    totalAvgAumCrCombined !== 0 ? totalCurrentQuarterAvgAumCrCombined / totalAvgAumCrCombined - 1 : null;
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
    totalAvgAumCrCombined,
    totalCurrentQuarterAvgAumCrCombined,
    totalAvgAumQoQChangePctCombined,
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
  showGoldSilver,
}: {
  label: string;
  totals: Totals;
  holdingsTitle?: string;
  historical: boolean;
  showNetFlow: boolean;
  showGoldSilver: boolean;
}) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right tabular-nums">{historical ? "—" : formatCr(totals.totalCurrentQuarterAvgAumCr)}</TableCell>
      <TableCell className="text-right tabular-nums">{historical ? "—" : formatCr(totals.totalAvgAumCr)}</TableCell>
      <PctCell value={historical ? null : totals.totalAvgAumQoQChangePct} className={GROUP_DIVIDER_CLASS} />
      {showGoldSilver && (
        <>
          <TableCell className={`text-right tabular-nums ${GS_CELL_CLASS}`}>
            {historical ? "—" : formatCr(totals.totalCurrentQuarterAvgAumCrCombined)}
          </TableCell>
          <TableCell className={`text-right tabular-nums ${GS_CELL_CLASS}`}>
            {historical ? "—" : formatCr(totals.totalAvgAumCrCombined)}
          </TableCell>
          <PctCell
            value={historical ? null : totals.totalAvgAumQoQChangePctCombined}
            className={`${GS_CELL_CLASS} ${GROUP_DIVIDER_CLASS}`}
          />
        </>
      )}
      <TableCell className="text-right tabular-nums">{formatCr(totals.totalLiveAumCr)}</TableCell>
      <PctCell value={totals.totalOneDayChangePct} />
      <TableCell className="text-right tabular-nums">{formatCr(totals.totalReportedAumCr)}</TableCell>
      <PctCell value={totals.totalLiveVsReportedPct} className={GROUP_DIVIDER_CLASS} />
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
  indexBenchmarkRows,
  isSearchActive,
  topN,
  reportPeriod,
  reportedColumnLabel,
  reportedColumnSublabel,
  avgWindowLabel,
  currentAvgWindowLabel,
  asOfDate,
  distinctHoldingsCount,
  distinctDebtInstrumentCount,
  distinctLivePricedCount,
  etfTotalsByAmc,
  showGoldSilver,
  onToggleGoldSilver,
}: {
  amcs: AmcLiveAum[];
  allAmcs: AmcLiveAum[];
  // Nifty 50 / Nifty 500 rows, rendered below Industry Total -- empty
  // while browsing a past date (Overview-level historical mode has no
  // live index level to show). Never folded into allAmcs/computeTotals.
  indexBenchmarkRows: IndexBenchmarkRow[];
  isSearchActive: boolean;
  topN: TopNOption;
  // Drives "Est. Net Flow" headers/export only -- always the CURRENT report
  // period, unaffected by the Reported AUM month picker (Net Flow is a
  // separate metric that isn't part of that adjustment).
  reportPeriod: string;
  // "Reported AUM"/"Hist. Live AUM" column's label + sublabel -- swaps
  // with the Overview toolbar's AUM Basis toggle. The underlying
  // amc.reportedAumCr/deltaPct values are already resolved to the right
  // source upstream (amc-grid.tsx) -- these props are display-only.
  // The adjacent "Exit AUM QoQ Change" column's label stays fixed
  // regardless of AUM Basis (it's always a QoQ comparison against
  // whichever value reportedColumnLabel currently points at).
  reportedColumnLabel: string;
  reportedColumnSublabel: string;
  // "Avg AUM" column's window -- defaults to the previous fiscal quarter.
  avgWindowLabel: string;
  // "Avg Live AUM" column's window -- defaults to the current fiscal
  // quarter to date. Independent picker from avgWindowLabel above.
  currentAvgWindowLabel: string;
  asOfDate: string | null;
  distinctHoldingsCount: number;
  distinctDebtInstrumentCount: number;
  distinctLivePricedCount: number;
  // Each AMC's Total (Gold+Silver) Reported AUM, keyed by overviewName --
  // from the Gold & Silver ETFs tab's own data (see
  // getEtfReportedAumTotalsByAmc). An AMC absent from this map runs no
  // Gold/Silver ETF and contributes 0.
  etfTotalsByAmc: Record<string, number>;
  // Lifted to AmcGrid (unlike showNetFlow below) because it also drives the
  // "Average Industry AUM" summary card above this table, not just the
  // table itself.
  showGoldSilver: boolean;
  onToggleGoldSilver: () => void;
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
      const av = sortValue(a, sortKey, etfTotalsByAmc);
      const bv = sortValue(b, sortKey, etfTotalsByAmc);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [limited, sortKey, sortDesc, etfTotalsByAmc]);

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

  function handleToggleGoldSilver() {
    // showGoldSilver is a prop (about to flip in the parent) -- its CURRENT
    // value here is what's about to be hidden.
    if (showGoldSilver && COMBINED_SORT_KEYS.includes(sortKey)) {
      setSortKey("liveAumCr");
      setSortDesc(true);
    }
    onToggleGoldSilver();
  }

  const headProps = { sortKey, sortDesc, onToggle: toggleSort };
  const periodLabel = formatReportPeriodLabel(reportPeriod);
  const historical = asOfDate !== null;
  const liveAumLabel = asOfDate ? `Live AUM (${formatShortDate(asOfDate)})` : "Live AUM";

  useRegisterExport(() => ({
    fileName: `overview-${asOfDate ?? new Date().toISOString().slice(0, 10)}`,
    sheetName: "Overview",
    rows: [
      ...sorted.map((amc) => {
        const combined = combinedAvgFigures(amc, etfTotalsByAmc);
        return {
          AMC: amc.overviewName,
          [`Avg Live AUM (${currentAvgWindowLabel}) (Cr)`]: historical ? null : (amc.currentQuarterAvgLiveAumCr ?? null),
          [`Avg AUM (${avgWindowLabel}) (Cr)`]: historical ? null : amc.avgLiveAumCr,
          "Avg AUM QoQ Change (%)": !historical && amc.avgAumQoQChangePct != null ? amc.avgAumQoQChangePct * 100 : null,
          // WYSIWYG: only exported while the toggle is on, unlike Est. Net
          // Flow below (which always exports regardless of its own toggle) --
          // a deliberate departure since this is an opt-in approximation.
          ...(showGoldSilver && {
            [`Avg Live AUM + Gold/Silver (${currentAvgWindowLabel}) (Cr)`]: historical ? null : combined.avgLiveAumCrCombined,
            [`Avg AUM + Gold/Silver (${avgWindowLabel}) (Cr)`]: historical ? null : combined.avgAumCrCombined,
            "Avg AUM QoQ Change + Gold/Silver (%)":
              !historical && combined.avgAumQoQChangePctCombined != null ? combined.avgAumQoQChangePctCombined * 100 : null,
          }),
          [`${liveAumLabel} (Cr)`]: amc.liveAumCr,
          "1D Change (%)": amc.oneDayChangePct !== null ? amc.oneDayChangePct * 100 : null,
          [`${reportedColumnLabel} ${reportedColumnSublabel} (Cr)`]: amc.reportedAumCr,
          "Exit AUM QoQ Change (%)": amc.deltaPct * 100,
          Holdings: historical ? null : amc.holdingsCount,
          Debt: historical ? null : amc.debtInstrumentCount,
          "Live Priced": historical ? null : amc.livePricedCount,
          [`Est. Net Flow ${periodLabel} (Cr)`]: amc.netFlowCr,
          [`Est. Net Flow ${periodLabel} (%)`]: amc.netFlowPct !== null ? amc.netFlowPct * 100 : null,
        };
      }),
      // Benchmark index rows (Nifty 50/500/Midcap 150/Smallcap 250) --
      // already an empty array in historical mode (see amc-grid.tsx), so
      // no separate `historical` guard needed here. Holdings/Debt/Live
      // Priced/Net Flow never apply to an index, matching the "—" shown
      // on-screen for these columns -- same treatment for Gold/Silver.
      ...indexBenchmarkRows.map((row) => ({
        AMC: row.displayName,
        [`Avg Live AUM (${currentAvgWindowLabel}) (Cr)`]: row.avgLiveAumCr,
        [`Avg AUM (${avgWindowLabel}) (Cr)`]: row.avgAumCr,
        "Avg AUM QoQ Change (%)": row.avgAumQoQChangePct != null ? row.avgAumQoQChangePct * 100 : null,
        ...(showGoldSilver && {
          [`Avg Live AUM + Gold/Silver (${currentAvgWindowLabel}) (Cr)`]: null,
          [`Avg AUM + Gold/Silver (${avgWindowLabel}) (Cr)`]: null,
          "Avg AUM QoQ Change + Gold/Silver (%)": null,
        }),
        [`${liveAumLabel} (Cr)`]: row.liveAumCr,
        "1D Change (%)": row.oneDayChangePct !== null ? row.oneDayChangePct * 100 : null,
        [`${reportedColumnLabel} ${reportedColumnSublabel} (Cr)`]: row.reportedAumCr,
        "Exit AUM QoQ Change (%)": row.deltaPct !== null ? row.deltaPct * 100 : null,
        Holdings: null,
        Debt: null,
        "Live Priced": null,
        [`Est. Net Flow ${periodLabel} (Cr)`]: null,
        [`Est. Net Flow ${periodLabel} (%)`]: null,
      })),
    ],
  }));

  const subsetTotals = computeTotals(limited, etfTotalsByAmc);
  const industryTotals = computeTotals(allAmcs, etfTotalsByAmc);

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleGoldSilver}
            title={GOLD_SILVER_TITLE}
            className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showGoldSilver ? "Hide Gold/Silver-adjusted AUM columns" : "+ Show Gold/Silver-adjusted AUM columns"}
          </button>
          <button
            type="button"
            onClick={toggleNetFlowColumns}
            className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showNetFlow ? "Hide Est. Net Flow columns" : "+ Show Est. Net Flow columns"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table className={showNetFlow ? "text-sm" : "text-base"}>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead
                colSpan={3}
                className={`text-center text-xs font-bold tracking-wide text-blue-900 uppercase dark:text-blue-300 ${GROUP_DIVIDER_CLASS}`}
              >
                Avg AUM Growth
              </TableHead>
              {showGoldSilver && (
                <TableHead
                  colSpan={3}
                  title={GOLD_SILVER_TITLE}
                  className={`text-center text-xs font-bold tracking-wide text-[var(--toolbar-accent)] uppercase ${GS_CELL_CLASS} ${GROUP_DIVIDER_CLASS}`}
                >
                  Avg AUM Growth + Gold/Silver
                </TableHead>
              )}
              <TableHead
                colSpan={4}
                className={`text-center text-xs font-bold tracking-wide text-blue-900 uppercase dark:text-blue-300 ${GROUP_DIVIDER_CLASS}`}
              >
                Exit AUM Growth
              </TableHead>
              <TableHead colSpan={3} className="text-center text-xs font-bold tracking-wide text-blue-900 uppercase dark:text-blue-300">
                Portfolio
              </TableHead>
              {showNetFlow && <TableHead colSpan={2} />}
            </TableRow>
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
                className={GROUP_DIVIDER_CLASS}
              />
              {showGoldSilver && (
                <>
                  <SortableHead
                    label="Avg Live AUM"
                    sublabel={currentAvgWindowLabel}
                    sk="avgLiveAumCrCombined"
                    {...headProps}
                    title={GOLD_SILVER_TITLE}
                    className={GS_CELL_CLASS}
                  />
                  <SortableHead
                    label="Avg AUM"
                    sublabel={avgWindowLabel}
                    sk="avgAumCrCombined"
                    {...headProps}
                    title={GOLD_SILVER_TITLE}
                    className={GS_CELL_CLASS}
                  />
                  <SortableHead
                    label="Avg AUM"
                    sublabel="QoQ Change"
                    sublabelAccent={false}
                    sk="avgAumQoQChangePctCombined"
                    {...headProps}
                    title={GOLD_SILVER_TITLE}
                    className={`${GS_CELL_CLASS} ${GROUP_DIVIDER_CLASS}`}
                  />
                </>
              )}
              <SortableHead
                label="Live AUM"
                sublabel={asOfDate ? formatShortDate(asOfDate) : undefined}
                sk="liveAumCr"
                {...headProps}
              />
              <SortableHead label="1D Change" sk="oneDayChangePct" {...headProps} />
              <SortableHead label={reportedColumnLabel} sublabel={reportedColumnSublabel} sk="reportedAumCr" {...headProps} />
              <SortableHead
                label="Exit AUM"
                sublabel="QoQ Change"
                sublabelAccent={false}
                sk="deltaPct"
                {...headProps}
                className={GROUP_DIVIDER_CLASS}
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
            {sorted.map((amc) => {
              const combined = combinedAvgFigures(amc, etfTotalsByAmc);
              return (
              <TableRow key={amc.amcId}>
                <TableCell className="font-serif font-medium">
                  <Link href={`/amc/${amc.slug}`} className="hover:underline">
                    {amc.overviewName}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {amc.currentQuarterAvgLiveAumCr != null ? formatCr(amc.currentQuarterAvgLiveAumCr) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {amc.avgLiveAumCr !== null ? formatCr(amc.avgLiveAumCr) : "—"}
                </TableCell>
                <PctCell value={amc.avgAumQoQChangePct} className={GROUP_DIVIDER_CLASS} />
                {showGoldSilver && (
                  <>
                    <TableCell className={`text-right tabular-nums ${GS_CELL_CLASS}`}>
                      {combined.avgLiveAumCrCombined != null ? formatCr(combined.avgLiveAumCrCombined) : "—"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${GS_CELL_CLASS}`}>
                      {combined.avgAumCrCombined != null ? formatCr(combined.avgAumCrCombined) : "—"}
                    </TableCell>
                    <PctCell value={combined.avgAumQoQChangePctCombined} className={`${GS_CELL_CLASS} ${GROUP_DIVIDER_CLASS}`} />
                  </>
                )}
                <TableCell className="text-right tabular-nums">{formatCr(amc.liveAumCr)}</TableCell>
                <PctCell value={amc.oneDayChangePct} />
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatCr(amc.reportedAumCr)}
                </TableCell>
                <PctCell value={amc.deltaPct} className={GROUP_DIVIDER_CLASS} />
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
              );
            })}
          </TableBody>
          <TableFooter>
            <TotalsRow
              label={subsetLabel}
              totals={subsetTotals}
              holdingsTitle={isRestricted ? subsetHoldingsTitle : undefined}
              historical={historical}
              showNetFlow={showNetFlow}
              showGoldSilver={showGoldSilver}
            />
            {isRestricted && (
              <TableRow className="text-muted-foreground">
                <TableCell>Industry Total (all {allAmcs.length} AMCs)</TableCell>
                <TableCell className="text-right tabular-nums">
                  {historical ? "—" : formatCr(industryTotals.totalCurrentQuarterAvgAumCr)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{historical ? "—" : formatCr(industryTotals.totalAvgAumCr)}</TableCell>
                <PctCell value={historical ? null : industryTotals.totalAvgAumQoQChangePct} className={GROUP_DIVIDER_CLASS} />
                {showGoldSilver && (
                  <>
                    <TableCell className={`text-right tabular-nums ${GS_CELL_CLASS}`}>
                      {historical ? "—" : formatCr(industryTotals.totalCurrentQuarterAvgAumCrCombined)}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${GS_CELL_CLASS}`}>
                      {historical ? "—" : formatCr(industryTotals.totalAvgAumCrCombined)}
                    </TableCell>
                    <PctCell
                      value={historical ? null : industryTotals.totalAvgAumQoQChangePctCombined}
                      className={`${GS_CELL_CLASS} ${GROUP_DIVIDER_CLASS}`}
                    />
                  </>
                )}
                <TableCell className="text-right tabular-nums">{formatCr(industryTotals.totalLiveAumCr)}</TableCell>
                <PctCell value={industryTotals.totalOneDayChangePct} />
                <TableCell className="text-right tabular-nums">{formatCr(industryTotals.totalReportedAumCr)}</TableCell>
                <PctCell value={industryTotals.totalLiveVsReportedPct} className={GROUP_DIVIDER_CLASS} />
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
            {indexBenchmarkRows.map((row) => (
              <TableRow key={row.indexKey} className="bg-muted/30">
                <TableCell className="font-serif font-medium">{row.displayName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.avgLiveAumCr !== null ? formatIndexLevel(row.avgLiveAumCr) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.avgAumCr !== null ? formatIndexLevel(row.avgAumCr) : "—"}
                </TableCell>
                <PctCell value={row.avgAumQoQChangePct} className={GROUP_DIVIDER_CLASS} />
                {showGoldSilver && (
                  <>
                    <TableCell className={`text-right tabular-nums text-muted-foreground ${GS_CELL_CLASS}`}>—</TableCell>
                    <TableCell className={`text-right tabular-nums text-muted-foreground ${GS_CELL_CLASS}`}>—</TableCell>
                    <TableCell className={`text-right tabular-nums text-muted-foreground ${GS_CELL_CLASS} ${GROUP_DIVIDER_CLASS}`}>
                      —
                    </TableCell>
                  </>
                )}
                <TableCell className="text-right tabular-nums">
                  {row.liveAumCr !== null ? formatIndexLevel(row.liveAumCr) : "—"}
                </TableCell>
                <PctCell value={row.oneDayChangePct} />
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.reportedAumCr !== null ? formatIndexLevel(row.reportedAumCr) : "—"}
                </TableCell>
                <PctCell value={row.deltaPct} className={GROUP_DIVIDER_CLASS} />
                <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                {showNetFlow && (
                  <>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
