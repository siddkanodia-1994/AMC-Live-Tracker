"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterExport } from "@/components/layout/export-context";
import { EditNumberCell } from "./edit-number-cell";
import { formatDeltaCr, formatPct, formatCr, formatReportPeriodLabel, formatShortDate } from "@/lib/utils/format";
import type { TopNOption } from "@/lib/utils/top-n";
import { useTotalAumGrowth } from "@/hooks/use-total-aum-growth";
import type { OverrideLastChange, TotalAumGrowthRow } from "@/lib/aum/total-aum-growth";

type SortKey =
  | "overviewName"
  | "liveAumCr"
  | "sipInflowCr"
  | "reportedAumCr"
  | "incomeDebtAumCr"
  | "otherFundsAumCr"
  | "totalLiveCr"
  | "totalReportedCr"
  | "growthPct";

interface Totals {
  totalLiveAumCr: number | null;
  totalSipInflowCr: number;
  totalReportedAumCr: number;
  totalIncomeDebtAumCr: number;
  totalOtherFundsAumCr: number;
  totalLiveCr: number | null;
  totalReportedCr: number | null;
  growthPct: number | null;
}

function computeTotals(rows: TotalAumGrowthRow[]): Totals {
  const totalSipInflowCr = rows.reduce((sum, r) => sum + r.sipInflowCr, 0);
  const totalReportedAumCr = rows.reduce((sum, r) => sum + r.reportedAumCr, 0);
  const totalIncomeDebtAumCr = rows.reduce((sum, r) => sum + r.incomeDebtAumCr, 0);
  const totalOtherFundsAumCr = rows.reduce((sum, r) => sum + r.otherFundsAumCr, 0);

  // Each of these three gates is independent -- Total (Reported)'s own month
  // can leave some AMCs without a figure (didn't exist that month) even when
  // Live AUM is fully populated, and vice versa. Growth % specifically needs
  // BOTH present on the same row, so it gets its own, stricter gate.
  const withTotalReported = rows.filter((r) => r.totalReportedCr !== null);
  const totalReportedCr =
    withTotalReported.length > 0 ? withTotalReported.reduce((sum, r) => sum + (r.totalReportedCr ?? 0), 0) : null;

  const withLive = rows.filter((r) => r.liveAumCr !== null);
  const totalLiveAumCr = withLive.length > 0 ? withLive.reduce((sum, r) => sum + (r.liveAumCr ?? 0), 0) : null;
  const totalLiveCr = withLive.length > 0 ? withLive.reduce((sum, r) => sum + (r.totalLiveCr ?? 0), 0) : null;

  const withBoth = rows.filter((r) => r.liveAumCr !== null && r.totalReportedCr !== null);
  const growthPct =
    withBoth.length > 0
      ? (() => {
          const liveSum = withBoth.reduce((sum, r) => sum + (r.totalLiveCr ?? 0), 0);
          const reportedSum = withBoth.reduce((sum, r) => sum + (r.totalReportedCr ?? 0), 0);
          return reportedSum !== 0 ? liveSum / reportedSum - 1 : null;
        })()
      : null;

  return {
    totalLiveAumCr,
    totalSipInflowCr,
    totalReportedAumCr,
    totalIncomeDebtAumCr,
    totalOtherFundsAumCr,
    totalLiveCr,
    totalReportedCr,
    growthPct,
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

function AumCrCell({ value, title }: { value: number | null; title?: string }) {
  return (
    <TableCell className="text-right tabular-nums text-muted-foreground" title={title}>
      {value !== null ? formatCr(value) : "—"}
    </TableCell>
  );
}

function TotalsRow({ label, totals, muted }: { label: string; totals: Totals; muted?: boolean }) {
  return (
    <TableRow className={muted ? "text-muted-foreground" : undefined}>
      <TableCell>{label}</TableCell>
      <AumCrCell value={totals.totalLiveAumCr} />
      <TableCell className="text-right tabular-nums">{formatDeltaCr(totals.totalSipInflowCr)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCr(totals.totalReportedAumCr)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCr(totals.totalIncomeDebtAumCr)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatCr(totals.totalOtherFundsAumCr)}</TableCell>
      <AumCrCell value={totals.totalLiveCr} />
      <AumCrCell value={totals.totalReportedCr} />
      <PctCell value={totals.growthPct} />
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

const dateInputClass =
  "rounded-md border bg-background px-2 py-1 text-sm hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

// Audit-trail hover text for an overridden cell -- when and from what the
// hand-entered figure diverged. null oldValueCr = it replaced the computed
// default directly.
function overrideTitle(change: OverrideLastChange | null): string | undefined {
  if (!change) return undefined;
  const was =
    change.oldValueCr !== null
      ? change.oldValueCr.toLocaleString("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })
      : "the computed default";
  return `Overridden ${formatShortDate(change.changedAt.slice(0, 10))} — was ${was}`;
}

export function TotalAumGrowthTable({ topN }: { topN: TopNOption }) {
  const [selectedAsOfDate, setSelectedAsOfDate] = useState<string | null>(null);
  const [selectedComponentPeriod, setSelectedComponentPeriod] = useState<string | null>(null);
  const [selectedTotalReportedPeriod, setSelectedTotalReportedPeriod] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useTotalAumGrowth(
    selectedAsOfDate ?? undefined,
    selectedComponentPeriod ?? undefined,
    selectedTotalReportedPeriod ?? undefined
  );
  const [sortKey, setSortKey] = useState<SortKey>("totalReportedCr");
  const [sortDesc, setSortDesc] = useState(true);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const effectiveAsOfDate = selectedAsOfDate ?? data?.asOfDate ?? null;
  const effectiveComponentPeriod = selectedComponentPeriod ?? data?.componentReportPeriod ?? null;
  const effectiveTotalReportedPeriod = selectedTotalReportedPeriod ?? data?.totalReportedReportPeriod ?? null;
  const availableReportPeriods = data?.availableReportPeriods ?? [];

  async function saveOverride(amcId: number, field: string, newValue: number | null) {
    const res = await fetch("/api/total-aum-growth/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amcId, reportPeriod: effectiveComponentPeriod, [field]: newValue }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Failed to save override");
    }
    await mutate();
  }

  // Ranked by Total (Reported) -- the truest "current size" figure this tab
  // has (unlike the AUM Growth tab, this one has a real Live AUM column too,
  // but that's date-picked and can be null for AMCs with no history yet, so
  // it's not a stable ranking basis). Missing figures (null) rank last.
  const limited = useMemo(() => {
    if (topN === "all") return rows;
    return [...rows].sort((a, b) => (b.totalReportedCr ?? -1) - (a.totalReportedCr ?? -1)).slice(0, topN);
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

  useRegisterExport(() => {
    const componentLabel = effectiveComponentPeriod ? formatReportPeriodLabel(effectiveComponentPeriod) : "";
    const totalReportedLabel = effectiveTotalReportedPeriod ? formatReportPeriodLabel(effectiveTotalReportedPeriod) : "";
    return {
      fileName: `total-aum-growth-${effectiveAsOfDate ?? "latest"}`,
      sheetName: "Total AUM Growth",
      rows: sorted.map((row) => ({
        AMC: row.overviewName,
        [effectiveAsOfDate ? `Live AUM ${formatShortDate(effectiveAsOfDate)} (Cr)` : "Live AUM (Cr)"]: row.liveAumCr,
        "SIP Inflows (Cr)": row.sipInflowCr,
        [`Reported AUM ${componentLabel} (Cr)`]: row.reportedAumCr,
        [`Income/Debt AUM ${componentLabel} (Cr)`]: row.incomeDebtAumCr,
        [`Other Funds AUM ${componentLabel} (Cr)`]: row.otherFundsAumCr,
        "Total Live (Cr)": row.totalLiveCr,
        [`Total Reported ${totalReportedLabel} (Cr)`]: row.totalReportedCr,
        "Growth (%)": row.growthPct !== null ? row.growthPct * 100 : null,
      })),
    };
  });

  const subsetTotals = computeTotals(limited);
  const industryTotals = computeTotals(rows);
  const isRestricted = topN !== "all";
  const subsetLabel = isRestricted ? `Total (Top ${topN} of ${rows.length} AMCs)` : `Total (all ${rows.length} AMCs)`;

  if (isLoading && !data) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  if (error) {
    return <p className="text-center text-muted-foreground">Failed to load Total AUM Growth: {error.message}</p>;
  }

  if (!data || rows.length === 0) {
    return <p className="text-center text-sm text-muted-foreground">No data available yet for this tab.</p>;
  }

  const liveAumColumnLabel = effectiveAsOfDate ? `Live AUM (${formatShortDate(effectiveAsOfDate)})` : "Live AUM";
  const componentPeriodLabel = effectiveComponentPeriod ? formatReportPeriodLabel(effectiveComponentPeriod) : "";
  const totalReportedPeriodLabel = effectiveTotalReportedPeriod ? formatReportPeriodLabel(effectiveTotalReportedPeriod) : "";
  const reportedAumColumnLabel = componentPeriodLabel ? `Reported AUM (${componentPeriodLabel})` : "Reported AUM";
  const incomeDebtColumnLabel = componentPeriodLabel ? `Income/Debt AUM (${componentPeriodLabel})` : "Income/Debt AUM";
  const otherFundsColumnLabel = componentPeriodLabel ? `Other Funds AUM (${componentPeriodLabel})` : "Other Funds AUM";
  const totalReportedColumnLabel = totalReportedPeriodLabel
    ? `Total (Reported) (${totalReportedPeriodLabel})`
    : "Total (Reported)";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Live AUM as of</span>
        <input
          type="date"
          value={effectiveAsOfDate ?? ""}
          min={data.minDate}
          max={data.maxDate}
          onChange={(e) => e.target.value && setSelectedAsOfDate(e.target.value)}
          className={dateInputClass}
          title={`Pick any date -- snaps to the closest date with real tracked history (${formatShortDate(data.minDate)} to ${formatShortDate(data.maxDate)}).`}
        />
        <span className="ml-4 text-muted-foreground">AUM breakdown month</span>
        <select
          value={effectiveComponentPeriod ?? ""}
          onChange={(e) => e.target.value && setSelectedComponentPeriod(e.target.value)}
          className={dateInputClass}
          title="Which month's Reported/Income-Debt/Other Funds AUM to show in the columns below. Independent of the other selectors."
        >
          {availableReportPeriods.map((p) => (
            <option key={p} value={p}>
              {formatReportPeriodLabel(p)}
            </option>
          ))}
        </select>
        <span className="ml-4 text-muted-foreground">Total Reported AUM month</span>
        <select
          value={effectiveTotalReportedPeriod ?? ""}
          onChange={(e) => e.target.value && setSelectedTotalReportedPeriod(e.target.value)}
          className={dateInputClass}
          title="Which month's actual total (Reported + Income-Debt + Other Funds AUM) to use for Total (Reported) and Growth %. Independent of the AUM breakdown month above -- the two can differ."
        >
          {availableReportPeriods.map((p) => (
            <option key={p} value={p}>
              {formatReportPeriodLabel(p)}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-muted-foreground">
        Every other tab tracks only each AMC&apos;s Growth/Equity Funds AUM. This tab surfaces the AMC&apos;s{" "}
        <em>true</em> total AUM (Growth/Equity + Income/Debt + Other Funds). Total (Live) estimates the current total
        by combining the live-tracked, date-picked equity AUM with SIP Inflows (a flow estimate for the current
        period, independent of either month selected above) and the AUM breakdown month&apos;s Income/Debt and Other
        Funds AUM. Total (Reported) is the AMC&apos;s actual reported total for the separately-selected Total
        Reported AUM month above — the two months can differ, e.g. to see one month&apos;s breakdown against a
        different month&apos;s actual total. Growth % compares the two regardless of whether they match. SIP
        Inflows, Reported AUM, Income/Debt AUM, and Other Funds AUM are editable — click a value to type a new one,
        or use the × to reset it back to the computed default.
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
              <SortableHead label={liveAumColumnLabel} sk="liveAumCr" {...headProps} />
              <SortableHead
                label="SIP Inflows"
                sk="sipInflowCr"
                {...headProps}
                title="Defaults to the Overview tab's Est. Net Flow (Cr) for the current period. Editable."
              />
              <SortableHead label={reportedAumColumnLabel} sk="reportedAumCr" {...headProps} title="Editable." />
              <SortableHead label={incomeDebtColumnLabel} sk="incomeDebtAumCr" {...headProps} title="Editable." />
              <SortableHead label={otherFundsColumnLabel} sk="otherFundsAumCr" {...headProps} title="Editable." />
              <SortableHead
                label="Total (Live)"
                sk="totalLiveCr"
                {...headProps}
                title="Live AUM + SIP Inflows + Income/Debt AUM + Other Funds AUM"
              />
              <SortableHead
                label={totalReportedColumnLabel}
                sk="totalReportedCr"
                {...headProps}
                title="That month's own Reported AUM + Income/Debt AUM + Other Funds AUM -- read-only, independent of the AUM breakdown month above."
              />
              <SortableHead label="Growth %" sk="growthPct" {...headProps} title="Total (Live) / Total (Reported) - 1" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <TableRow key={row.amcId}>
                <TableCell className="font-serif font-medium">
                  <Link href={`/amc/${row.slug}`} className="hover:underline">
                    {row.overviewName}
                  </Link>
                </TableCell>
                <AumCrCell
                  value={row.liveAumCr}
                  title={row.liveAumAsOfDate ? `As of ${formatShortDate(row.liveAumAsOfDate)}` : "No live history yet"}
                />
                <EditNumberCell
                  value={row.sipInflowCr}
                  isOverridden={row.sipInflowIsOverridden}
                  title={overrideTitle(row.sipInflowLastChange)}
                  onSave={(v) => saveOverride(row.amcId, "sipInflowOverrideCr", v)}
                />
                <EditNumberCell
                  value={row.reportedAumCr}
                  isOverridden={row.reportedAumIsOverridden}
                  title={overrideTitle(row.reportedAumLastChange)}
                  onSave={(v) => saveOverride(row.amcId, "reportedAumOverrideCr", v)}
                />
                <EditNumberCell
                  value={row.incomeDebtAumCr}
                  isOverridden={row.incomeDebtAumIsOverridden}
                  title={overrideTitle(row.incomeDebtAumLastChange)}
                  onSave={(v) => saveOverride(row.amcId, "incomeDebtAumOverrideCr", v)}
                />
                <EditNumberCell
                  value={row.otherFundsAumCr}
                  isOverridden={row.otherFundsAumIsOverridden}
                  title={overrideTitle(row.otherFundsAumLastChange)}
                  onSave={(v) => saveOverride(row.amcId, "otherFundsAumOverrideCr", v)}
                />
                <AumCrCell value={row.totalLiveCr} />
                <AumCrCell value={row.totalReportedCr} />
                <PctCell value={row.growthPct} />
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
