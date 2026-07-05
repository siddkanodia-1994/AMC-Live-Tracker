"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCr, formatPct } from "@/lib/utils/format";
import { useAumGrowth } from "@/hooks/use-aum-growth";
import type { AumGrowthRow } from "@/lib/aum/aum-growth";

type SortKey = "overviewName" | "periodAReportedAumCr" | "periodBReportedAumCr" | "growthPct" | "pricePerformancePct" | "netFlowPct";
type TopNOption = 10 | 15 | 20 | "all";

const TOP_N_OPTIONS: TopNOption[] = [10, 15, 20, "all"];
const DEFAULT_TOP_N: TopNOption = 20;

const NET_FLOW_TITLE =
  "(Reported AUM in the later period minus the earlier period's holdings repriced to the later period's last close) divided by the EARLIER period's reported AUM. This is a different denominator than the \"Est. Net Flow (%)\" column on the Overview tab (which divides by the computed baseline) -- chosen here specifically so Price Performance % + this % always sum to exactly Growth %.";
const PRICE_PERF_TITLE =
  "How much the earlier period's same holdings (same shares, no trading) would have grown from pure price movement alone, as a % of the earlier period's reported AUM. Requires the historical-price backfill to have been run for this specific period pair -- shows — otherwise.";

interface GrowthTotals {
  totalPeriodAReportedAumCr: number;
  totalPeriodBReportedAumCr: number;
  totalGrowthPct: number | null;
  totalPricePerformancePct: number | null;
  totalNetFlowPct: number | null;
}

function computeGrowthTotals(list: AumGrowthRow[]): GrowthTotals {
  const totalPeriodAReportedAumCr = list.reduce((sum, r) => sum + r.periodAReportedAumCr, 0);
  const totalPeriodBReportedAumCr = list.reduce((sum, r) => sum + r.periodBReportedAumCr, 0);
  const totalGrowthPct =
    totalPeriodAReportedAumCr !== 0 ? (totalPeriodBReportedAumCr - totalPeriodAReportedAumCr) / totalPeriodAReportedAumCr : null;

  // Only over AMCs whose historical repricing has been backfilled, so AMCs
  // without that data (e.g. a not-yet-backfilled period pair) don't skew the
  // total -- same reasoning as the Overview table's Est. Net Flow total.
  const withComputedB = list.filter((r) => r.computedBAumCr !== null);
  const totalAForComputed = withComputedB.reduce((sum, r) => sum + r.periodAReportedAumCr, 0);
  const totalBForComputed = withComputedB.reduce((sum, r) => sum + r.periodBReportedAumCr, 0);
  const totalComputedB = withComputedB.reduce((sum, r) => sum + (r.computedBAumCr ?? 0), 0);
  const totalPricePerformancePct =
    withComputedB.length > 0 && totalAForComputed !== 0 ? (totalComputedB - totalAForComputed) / totalAForComputed : null;
  const totalNetFlowPct =
    withComputedB.length > 0 && totalAForComputed !== 0 ? (totalBForComputed - totalComputedB) / totalAForComputed : null;

  return { totalPeriodAReportedAumCr, totalPeriodBReportedAumCr, totalGrowthPct, totalPricePerformancePct, totalNetFlowPct };
}

function PctCell({ value }: { value: number | null }) {
  if (value === null) {
    return <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>;
  }
  return (
    <TableCell className="text-right tabular-nums">
      <span className={value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
        {formatPct(value, { alwaysSign: true })}
      </span>
    </TableCell>
  );
}

function TotalsRow({ label, totals, muted }: { label: string; totals: GrowthTotals; muted?: boolean }) {
  return (
    <TableRow className={muted ? "text-muted-foreground" : undefined}>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCr(totals.totalPeriodAReportedAumCr)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCr(totals.totalPeriodBReportedAumCr)}</TableCell>
      <PctCell value={totals.totalGrowthPct} />
      <PctCell value={totals.totalPricePerformancePct} />
      <PctCell value={totals.totalNetFlowPct} />
    </TableRow>
  );
}

function SortableHead({
  label,
  sk,
  sortKey,
  sortDesc,
  onToggle,
  title,
}: {
  label: string;
  sk: SortKey;
  sortKey: SortKey;
  sortDesc: boolean;
  onToggle: (key: SortKey) => void;
  title?: string;
}) {
  const active = sk === sortKey;
  return (
    <TableHead className="text-right first:text-left" title={title}>
      <button
        type="button"
        onClick={() => onToggle(sk)}
        className={`hover:text-foreground ${active ? "font-medium text-foreground" : ""}`}
      >
        {label}
        {active ? (sortDesc ? " ↓" : " ↑") : ""}
      </button>
    </TableHead>
  );
}

const selectClass =
  "rounded-md border bg-background px-2 py-1 text-sm hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

export function AumGrowthTable() {
  const [selectedA, setSelectedA] = useState<string | null>(null);
  const [selectedB, setSelectedB] = useState<string | null>(null);
  const { data, error, isLoading } = useAumGrowth(selectedA ?? undefined, selectedB ?? undefined);
  const [sortKey, setSortKey] = useState<SortKey>("periodBReportedAumCr");
  const [sortDesc, setSortDesc] = useState(true);
  const [topN, setTopN] = useState<TopNOption>(DEFAULT_TOP_N);

  const allPeriods = data?.periods ?? [];
  const effectiveA = selectedA ?? data?.periodA ?? null;
  const effectiveB = selectedB ?? data?.periodB ?? null;

  // The most recent period can never be a valid "earlier" side -- there's
  // nothing after it to compare against yet.
  const periodAOptions = allPeriods.slice(0, -1);
  const periodBOptions = effectiveA ? allPeriods.filter((p) => p > effectiveA) : allPeriods;

  function defaultBFor(periodsList: string[], a: string): string | null {
    const idx = periodsList.indexOf(a);
    if (idx === -1) return periodsList[periodsList.length - 1] ?? null;
    return periodsList[idx + 1] ?? periodsList[periodsList.length - 1] ?? null;
  }

  function handlePeriodAChange(newA: string) {
    setSelectedA(newA);
    if (effectiveB === null || effectiveB <= newA) {
      setSelectedB(defaultBFor(allPeriods, newA));
    }
  }

  const rows = useMemo(() => data?.rows ?? [], [data]);

  // Top-N is always by periodB's reported AUM specifically (the closest
  // equivalent to "current size" here -- this tab has no Live AUM column),
  // independent of whatever column the table is currently sorted by for
  // display. No search box on this tab, so no override-while-searching case.
  const limited = useMemo(() => {
    if (topN === "all") return rows;
    return [...rows].sort((a, b) => b.periodBReportedAumCr - a.periodBReportedAumCr).slice(0, topN);
  }, [rows, topN]);

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

  const headProps = { sortKey, sortDesc, onToggle: toggleSort };

  const subsetTotals = computeGrowthTotals(limited);
  const industryTotals = computeGrowthTotals(rows);
  const isRestricted = topN !== "all";
  const subsetLabel = isRestricted ? `Total (Top ${topN} of ${rows.length} AMCs)` : `Total (all ${rows.length} AMCs)`;

  if (isLoading && !data) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  if (error) {
    return <p className="text-center text-muted-foreground">Failed to load AUM growth comparison: {error.message}</p>;
  }

  if (!data || allPeriods.length < 2 || !effectiveA || !effectiveB) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Needs at least two imported report periods to compare — only {allPeriods.length} exists so far.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Compare</span>
        <select value={effectiveA} onChange={(e) => handlePeriodAChange(e.target.value)} className={selectClass}>
          {periodAOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <span className="text-muted-foreground">to</span>
        <select value={effectiveB} onChange={(e) => setSelectedB(e.target.value)} className={selectClass}>
          {periodBOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

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

      <p className="text-xs text-muted-foreground">
        Growth % is total reported-AUM growth from {effectiveA} to {effectiveB}. Price Performance % and Net Flow %
        split that growth into two pieces — both are a % of {effectiveA}&apos;s reported AUM, so they always sum to
        exactly Growth %. Top-N ranks by reported AUM in {effectiveB}.
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button
                  type="button"
                  onClick={() => toggleSort("overviewName")}
                  className={`hover:text-foreground ${sortKey === "overviewName" ? "font-medium text-foreground" : ""}`}
                >
                  AMC
                  {sortKey === "overviewName" ? (sortDesc ? " ↓" : " ↑") : ""}
                </button>
              </TableHead>
              <SortableHead label={`Reported AUM (${effectiveA})`} sk="periodAReportedAumCr" {...headProps} />
              <SortableHead label={`Reported AUM (${effectiveB})`} sk="periodBReportedAumCr" {...headProps} />
              <SortableHead label="Growth %" sk="growthPct" {...headProps} />
              <SortableHead label="Price Performance %" sk="pricePerformancePct" {...headProps} title={PRICE_PERF_TITLE} />
              <SortableHead label={`Net Flow % (of ${effectiveA} AUM)`} sk="netFlowPct" {...headProps} title={NET_FLOW_TITLE} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row: AumGrowthRow) => (
              <TableRow key={row.amcId}>
                <TableCell className="font-medium">
                  <Link href={`/amc/${row.slug}`} className="hover:underline">
                    {row.overviewName}
                  </Link>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatCr(row.periodAReportedAumCr)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {formatCr(row.periodBReportedAumCr)}
                </TableCell>
                <PctCell value={row.growthPct} />
                <PctCell value={row.pricePerformancePct} />
                <PctCell value={row.netFlowPct} />
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TotalsRow label={subsetLabel} totals={subsetTotals} />
            {isRestricted && <TotalsRow label={`Industry Total (all ${rows.length} AMCs)`} totals={industryTotals} muted />}
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
