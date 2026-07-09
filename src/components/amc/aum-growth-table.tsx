"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterExport } from "@/components/layout/export-context";
import { formatCr, formatDeltaCr, formatPct, formatShortDate } from "@/lib/utils/format";
import { closestDateAtOrBefore } from "@/lib/aum/report-period";
import type { TopNOption } from "@/lib/utils/top-n";
import { useAumGrowth } from "@/hooks/use-aum-growth";
import type { AumGrowthRow, RepriceBasis } from "@/lib/aum/aum-growth";

type SortKey =
  | "overviewName"
  | "periodAReportedAumCr"
  | "periodBReportedAumCr"
  | "computedAtDateCr"
  | "growthCr"
  | "growthPct"
  | "pricePerformanceCr"
  | "pricePerformancePct"
  | "netFlowCr"
  | "netFlowPct";

function pricePerfTitle(basis: RepriceBasis, periodA: string, periodB: string, asOfDate: string | null): string {
  const dateLabel = asOfDate ? formatShortDate(asOfDate) : "the selected date";
  if (basis === "B") {
    return `How much ${periodB}'s own reported holdings (same shares, no trading) have moved from pure price alone since ${periodB}'s own report, valued as of ${dateLabel} -- as a % of ${periodB}'s own reported AUM. A different, unrelated-to-Growth% number from the basis-${periodA} version.`;
  }
  return `How much ${periodA}'s same holdings (same shares, no trading) would have grown from pure price movement alone, valued as of ${dateLabel}, as a % of ${periodA}'s reported AUM. Requires the historical-price backfill to have been run through this date -- shows — otherwise.`;
}

function netFlowTitle(basis: RepriceBasis, periodA: string, periodB: string): string {
  if (basis === "B") {
    return `Not shown when repricing ${periodB}'s own holdings -- there's no later reported figure to reconcile its price drift against, so the growth-into-price-vs-flow split only works when repricing ${periodA}'s holdings. Switch "Computed AUM using" above to see it.`;
  }
  return `(Reported AUM in the later period minus the earlier period's holdings repriced to the selected date) divided by the EARLIER period's reported AUM. Same denominator as the Overview tab's "Est. Net Flow (%)" -- chosen here specifically so Price Performance % + this % always sum to exactly Growth %.`;
}

interface GrowthTotals {
  totalPeriodAReportedAumCr: number;
  totalPeriodBReportedAumCr: number;
  totalComputedAtDateCr: number | null;
  totalGrowthCr: number;
  totalGrowthPct: number | null;
  totalPricePerformanceCr: number | null;
  totalPricePerformancePct: number | null;
  totalNetFlowCr: number | null;
  totalNetFlowPct: number | null;
}

function computeGrowthTotals(list: AumGrowthRow[], basis: RepriceBasis): GrowthTotals {
  const totalPeriodAReportedAumCr = list.reduce((sum, r) => sum + r.periodAReportedAumCr, 0);
  const totalPeriodBReportedAumCr = list.reduce((sum, r) => sum + r.periodBReportedAumCr, 0);
  const totalGrowthCr = totalPeriodBReportedAumCr - totalPeriodAReportedAumCr;
  const totalGrowthPct = totalPeriodAReportedAumCr !== 0 ? totalGrowthCr / totalPeriodAReportedAumCr : null;

  // Gated on computedAtDateCr specifically, independent of the Net Flow gate
  // below -- under basis B these diverge (Computed AUM/Price Performance are
  // populated, Net Flow deliberately isn't), so a single shared filter would
  // incorrectly conflate them.
  const withComputed = list.filter((r) => r.computedAtDateCr !== null);
  const totalComputedAtDate = withComputed.reduce((sum, r) => sum + (r.computedAtDateCr ?? 0), 0);
  const totalAForComputed = withComputed.reduce((sum, r) => sum + r.periodAReportedAumCr, 0);
  const totalBForComputed = withComputed.reduce((sum, r) => sum + r.periodBReportedAumCr, 0);
  const anchor = basis === "B" ? totalBForComputed : totalAForComputed;
  const totalPricePerformanceCr = withComputed.length > 0 ? totalComputedAtDate - anchor : null;
  const totalPricePerformancePct = totalPricePerformanceCr !== null && anchor !== 0 ? totalPricePerformanceCr / anchor : null;

  const withNetFlow = list.filter((r) => r.netFlowCr !== null);
  const totalAForNetFlow = withNetFlow.reduce((sum, r) => sum + r.periodAReportedAumCr, 0);
  const totalNetFlowCr = withNetFlow.length > 0 ? withNetFlow.reduce((sum, r) => sum + (r.netFlowCr ?? 0), 0) : null;
  const totalNetFlowPct = totalNetFlowCr !== null && totalAForNetFlow !== 0 ? totalNetFlowCr / totalAForNetFlow : null;

  return {
    totalPeriodAReportedAumCr,
    totalPeriodBReportedAumCr,
    totalComputedAtDateCr: withComputed.length > 0 ? totalComputedAtDate : null,
    totalGrowthCr,
    totalGrowthPct,
    totalPricePerformanceCr,
    totalPricePerformancePct,
    totalNetFlowCr,
    totalNetFlowPct,
  };
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

function AumCrCell({ value }: { value: number | null }) {
  return (
    <TableCell className="text-right tabular-nums text-muted-foreground">{value !== null ? formatCr(value) : "—"}</TableCell>
  );
}

function TotalsRow({ label, totals, muted }: { label: string; totals: GrowthTotals; muted?: boolean }) {
  return (
    <TableRow className={muted ? "text-muted-foreground" : undefined}>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCr(totals.totalPeriodAReportedAumCr)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCr(totals.totalPeriodBReportedAumCr)}</TableCell>
      <DeltaCrCell value={totals.totalGrowthCr} />
      <PctCell value={totals.totalGrowthPct} />
      <AumCrCell value={totals.totalComputedAtDateCr} />
      <DeltaCrCell value={totals.totalPricePerformanceCr} />
      <PctCell value={totals.totalPricePerformancePct} />
      <DeltaCrCell value={totals.totalNetFlowCr} />
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

const basisToggleClass = (active: boolean) =>
  `rounded-md px-2 py-1 text-sm ${active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`;

export function AumGrowthTable({ topN }: { topN: TopNOption }) {
  const [selectedA, setSelectedA] = useState<string | null>(null);
  const [selectedB, setSelectedB] = useState<string | null>(null);
  const [selectedBasis, setSelectedBasis] = useState<RepriceBasis | null>(null);
  const [selectedAsOfDate, setSelectedAsOfDate] = useState<string | null>(null);
  const { data, error, isLoading } = useAumGrowth(
    selectedA ?? undefined,
    selectedB ?? undefined,
    selectedBasis ?? undefined,
    selectedAsOfDate ?? undefined
  );
  const [sortKey, setSortKey] = useState<SortKey>("periodBReportedAumCr");
  const [sortDesc, setSortDesc] = useState(true);

  const allPeriods = data?.periods ?? [];
  const effectiveA = selectedA ?? data?.periodA ?? null;
  const effectiveB = selectedB ?? data?.periodB ?? null;
  const effectiveBasis: RepriceBasis = selectedBasis ?? data?.repriceBasis ?? "A";
  const effectiveAsOfDate = selectedAsOfDate ?? data?.asOfDate ?? null;
  const datesForA = data?.datesForA ?? [];
  const datesForB = data?.datesForB ?? [];
  const activeDates = effectiveBasis === "B" ? datesForB : datesForA;
  const hasCustomRepricing = selectedBasis !== null || selectedAsOfDate !== null;

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
    // New periods mean a new valid date range -- can't know it client-side
    // before the refetch resolves, so fall back to the server's own default.
    setSelectedAsOfDate(null);
  }

  function handlePeriodBChange(newB: string) {
    setSelectedB(newB);
    setSelectedAsOfDate(null);
  }

  function handleBasisChange(newBasis: RepriceBasis) {
    setSelectedBasis(newBasis);
    const newBasisDates = newBasis === "B" ? datesForB : datesForA;
    if (effectiveAsOfDate === null || !newBasisDates.includes(effectiveAsOfDate)) {
      setSelectedAsOfDate(null);
    }
  }

  function handleReset() {
    setSelectedBasis(null);
    setSelectedAsOfDate(null);
  }

  // The native date input's calendar lets you click any day in [min, max],
  // not just ones with real backfilled data (there's no reliable
  // cross-browser way to gray out individual invalid dates inside a native
  // picker). Snap whatever's picked to the closest date that actually has
  // data, using the same "closest on or before" tolerance the server-side
  // query already uses -- so the calendar is a real month-grid picker, but
  // can never actually select an empty date.
  function handleAsOfDateInputChange(raw: string) {
    if (!raw) return;
    setSelectedAsOfDate(closestDateAtOrBefore(activeDates, raw));
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

  useRegisterExport(() => ({
    fileName: `aum-growth-${effectiveA ?? "na"}-to-${effectiveB ?? "na"}`,
    sheetName: "AUM Growth",
    rows: sorted.map((row: AumGrowthRow) => ({
      AMC: row.overviewName,
      [`Reported AUM ${effectiveA} (Cr)`]: row.periodAReportedAumCr,
      [`Reported AUM ${effectiveB} (Cr)`]: row.periodBReportedAumCr,
      "Growth (Cr)": row.growthCr,
      "Growth (%)": row.growthPct !== null ? row.growthPct * 100 : null,
      [effectiveAsOfDate ? `Computed AUM ${formatShortDate(effectiveAsOfDate)} (Cr)` : "Computed AUM (Cr)"]:
        row.computedAtDateCr,
      "Price Performance (Cr)": row.pricePerformanceCr,
      "Price Performance (%)": row.pricePerformancePct !== null ? row.pricePerformancePct * 100 : null,
      "Net Flow (Cr)": row.netFlowCr,
      [`Net Flow % of ${effectiveA} AUM`]: row.netFlowPct !== null ? row.netFlowPct * 100 : null,
    })),
  }));

  const subsetTotals = computeGrowthTotals(limited, effectiveBasis);
  const industryTotals = computeGrowthTotals(rows, effectiveBasis);
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

  const basisPeriodLabel = effectiveBasis === "B" ? effectiveB : effectiveA;
  const computedColumnLabel = effectiveAsOfDate ? `Computed AUM (${formatShortDate(effectiveAsOfDate)})` : "Computed AUM";

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
        <select value={effectiveB} onChange={(e) => handlePeriodBChange(e.target.value)} className={selectClass}>
          {periodBOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Computed AUM using</span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => handleBasisChange("A")} className={basisToggleClass(effectiveBasis === "A")}>
            {effectiveA}&apos;s holdings
          </button>
          <button type="button" onClick={() => handleBasisChange("B")} className={basisToggleClass(effectiveBasis === "B")}>
            {effectiveB}&apos;s holdings
          </button>
        </div>
        <span className="text-muted-foreground">repriced as of</span>
        {activeDates.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            No backfilled data for {basisPeriodLabel} yet — run the historical backfill for it.
          </span>
        ) : (
          <input
            type="date"
            value={effectiveAsOfDate ?? ""}
            min={activeDates[0]}
            max={activeDates[activeDates.length - 1]}
            onChange={(e) => handleAsOfDateInputChange(e.target.value)}
            className={selectClass}
            title={`Pick any date -- snaps to the closest date with real backfilled data (${formatShortDate(activeDates[0])} to ${formatShortDate(activeDates[activeDates.length - 1])}).`}
          />
        )}
        {hasCustomRepricing && (
          <button type="button" onClick={handleReset} className="text-xs text-muted-foreground underline hover:text-foreground">
            Reset
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Growth % is total reported-AUM growth from {effectiveA} to {effectiveB} — it never changes below, regardless
        of the repricing settings above. When repricing {effectiveA}&apos;s holdings (the default), Price Performance
        % and Net Flow % split Growth % into a price-driven piece and a flow-driven piece, both as a % of{" "}
        {effectiveA}&apos;s reported AUM, so they always sum to exactly Growth %. When repricing {effectiveB}&apos;s
        holdings instead, Net Flow isn&apos;t shown (there&apos;s no later reported figure to reconcile against), and
        Price Performance % switches to a % of {effectiveB}&apos;s own reported AUM — a different, unrelated-to-Growth%
        number. Top-N ranks by reported AUM in {effectiveB}.
      </p>

      <div className="overflow-x-auto rounded-lg border bg-card">
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
              <SortableHead label="Growth (Cr)" sk="growthCr" {...headProps} />
              <SortableHead label="Growth %" sk="growthPct" {...headProps} />
              <SortableHead
                label={computedColumnLabel}
                sk="computedAtDateCr"
                {...headProps}
                title={`${basisPeriodLabel}'s holdings repriced as of the selected date above.`}
              />
              <SortableHead
                label="Price Performance (Cr)"
                sk="pricePerformanceCr"
                {...headProps}
                title={pricePerfTitle(effectiveBasis, effectiveA, effectiveB, effectiveAsOfDate)}
              />
              <SortableHead
                label="Price Performance %"
                sk="pricePerformancePct"
                {...headProps}
                title={pricePerfTitle(effectiveBasis, effectiveA, effectiveB, effectiveAsOfDate)}
              />
              <SortableHead
                label="Net Flow (Cr)"
                sk="netFlowCr"
                {...headProps}
                title={netFlowTitle(effectiveBasis, effectiveA, effectiveB)}
              />
              <SortableHead
                label={`Net Flow % (of ${effectiveA} AUM)`}
                sk="netFlowPct"
                {...headProps}
                title={netFlowTitle(effectiveBasis, effectiveA, effectiveB)}
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row: AumGrowthRow) => (
              <TableRow key={row.amcId}>
                <TableCell className="font-serif font-medium">
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
                <DeltaCrCell value={row.growthCr} />
                <PctCell value={row.growthPct} />
                <AumCrCell value={row.computedAtDateCr} />
                <DeltaCrCell value={row.pricePerformanceCr} />
                <PctCell value={row.pricePerformancePct} />
                <DeltaCrCell value={row.netFlowCr} />
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
