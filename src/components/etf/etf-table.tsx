"use client";

import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterExport } from "@/components/layout/export-context";
import { formatPriceInr, formatCr, formatPct, formatReportPeriodLabel, formatShortDate } from "@/lib/utils/format";
import { useEtfLiveAum } from "@/hooks/use-etf-live-aum";
import { useEtfAverageAum } from "@/hooks/use-etf-average-aum";
import { useMcxReference } from "@/hooks/use-mcx-reference";
import type { EtfLiveAum } from "@/lib/etf/compute-live-aum";

// EtfLiveAum plus the two real daily-AUM-based average figures (prior
// fiscal quarter / current fiscal quarter-to-date), computed from
// etf_daily_aum_estimate -- see src/lib/etf/average-aum.ts. Kept as a
// distinct local type rather than widening EtfLiveAum itself, since the
// average figures come from a separate endpoint/hook and can legitimately
// be absent (a scheme with fewer than 2 Exit AUM anchors has no computed
// daily series yet) even when live AUM is present.
interface EtfRow extends EtfLiveAum {
  avgAumCr: number | null; // prior fiscal quarter
  currentAvgAumCr: number | null; // current fiscal quarter-to-date
}

function mergeAverageAum(
  schemes: EtfLiveAum[],
  avgAumByScheme: Record<number, { avgAumCr: number }> | undefined,
  currentAvgAumByScheme: Record<number, { avgAumCr: number }> | undefined
): EtfRow[] {
  return schemes.map((s) => ({
    ...s,
    avgAumCr: avgAumByScheme?.[s.schemeId]?.avgAumCr ?? null,
    currentAvgAumCr: currentAvgAumByScheme?.[s.schemeId]?.avgAumCr ?? null,
  }));
}

// MCX Gold/Silver only trade as futures contracts (no true spot market),
// so this uses the front-month contract's own price as of the same
// quarter-end date the ETF schemes' navAtPeriodEnd is anchored to, vs its
// latest available price -- the same point-to-point shape as the ETF
// schemes' own return above (liveNav / navAtPeriodEnd - 1), just sourced
// independently from MCX instead of NAV. An earlier version averaged
// daily closes across each quarter instead; real data showed that could
// diverge sharply, even in sign, from this point-to-point figure
// whenever a quarter had a volatility spike or was still partial (see
// src/lib/mcx/compute.ts) -- switched after that surfaced.
const MCX_TITLE =
  "Front-month MCX futures contract (no true spot market exists for gold/silver) — price as of the same quarter-end date the ETF schemes' Reported AUM is anchored to, vs its latest available price. Same point-to-point calculation as the ETF returns above, just independently sourced from MCX instead of NAV.";

interface AmcEtfRow {
  amc: string;
  gold: EtfRow | null;
  silver: EtfRow | null;
  totalReportedAumCr: number | null;
  totalLiveAumCr: number | null;
  totalDeltaPct: number | null;
  totalAvgAumCr: number | null;
  totalCurrentAvgAumCr: number | null;
  // Older (more conservative) of gold's/silver's own liveNavDate -- the
  // combined Total is only as fresh as its stalest half.
  totalLiveNavDate: string | null;
}

function olderDate(a: string | null | undefined, b: string | null | undefined): string | null {
  if (a && b) return a < b ? a : b;
  return a ?? b ?? null;
}

// Oldest liveNavDate across a set of rows -- used for the footer's
// multi-AMC totals, which are only as fresh as the stalest scheme feeding
// into them.
function oldestDate(dates: (string | null | undefined)[]): string | null {
  return dates.reduce<string | null>((min, d) => olderDate(min, d), null);
}

type SortKey =
  | "amc"
  | "goldReportedAumCr"
  | "goldLiveAumCr"
  | "goldDeltaPct"
  | "goldAvgAumCr"
  | "goldCurrentAvgAumCr"
  | "silverReportedAumCr"
  | "silverLiveAumCr"
  | "silverDeltaPct"
  | "silverAvgAumCr"
  | "silverCurrentAvgAumCr"
  | "totalReportedAumCr"
  | "totalLiveAumCr"
  | "totalDeltaPct"
  | "totalAvgAumCr"
  | "totalCurrentAvgAumCr";

// Divider between the Gold ETF / Silver ETF / Total column groups -- same
// low-opacity treatment as the equity Overview table's GROUP_DIVIDER_CLASS,
// applied at every row type so it reads as one continuous rule.
const GROUP_DIVIDER_CLASS = "border-r border-blue-900/20 dark:border-blue-300/20";

function groupByAmc(schemes: EtfRow[]): AmcEtfRow[] {
  const byAmc = new Map<string, { gold: EtfRow | null; silver: EtfRow | null }>();
  for (const scheme of schemes) {
    const entry = byAmc.get(scheme.amc) ?? { gold: null, silver: null };
    if (scheme.assetClass === "gold") entry.gold = scheme;
    else entry.silver = scheme;
    byAmc.set(scheme.amc, entry);
  }
  return Array.from(byAmc.entries()).map(([amc, { gold, silver }]) => {
    const hasReported = gold?.reportedAumCr != null || silver?.reportedAumCr != null;
    const hasLive = gold?.liveAumCr != null || silver?.liveAumCr != null;
    const hasAvg = gold?.avgAumCr != null || silver?.avgAumCr != null;
    const hasCurrentAvg = gold?.currentAvgAumCr != null || silver?.currentAvgAumCr != null;
    const totalReportedAumCr = hasReported ? (gold?.reportedAumCr ?? 0) + (silver?.reportedAumCr ?? 0) : null;
    const totalLiveAumCr = hasLive ? (gold?.liveAumCr ?? 0) + (silver?.liveAumCr ?? 0) : null;
    const totalAvgAumCr = hasAvg ? (gold?.avgAumCr ?? 0) + (silver?.avgAumCr ?? 0) : null;
    const totalCurrentAvgAumCr = hasCurrentAvg ? (gold?.currentAvgAumCr ?? 0) + (silver?.currentAvgAumCr ?? 0) : null;
    const totalDeltaPct =
      totalReportedAumCr !== null && totalLiveAumCr !== null && totalReportedAumCr !== 0
        ? (totalLiveAumCr - totalReportedAumCr) / totalReportedAumCr
        : null;
    const totalLiveNavDate = hasLive ? olderDate(gold?.liveNavDate, silver?.liveNavDate) : null;
    return { amc, gold, silver, totalReportedAumCr, totalLiveAumCr, totalDeltaPct, totalAvgAumCr, totalCurrentAvgAumCr, totalLiveNavDate };
  });
}

function sortValue(row: AmcEtfRow, key: SortKey): number | string | null {
  switch (key) {
    case "amc":
      return row.amc;
    case "goldReportedAumCr":
      return row.gold?.reportedAumCr ?? null;
    case "goldLiveAumCr":
      return row.gold?.liveAumCr ?? null;
    case "goldDeltaPct":
      return row.gold?.deltaPct ?? null;
    case "goldAvgAumCr":
      return row.gold?.avgAumCr ?? null;
    case "goldCurrentAvgAumCr":
      return row.gold?.currentAvgAumCr ?? null;
    case "silverReportedAumCr":
      return row.silver?.reportedAumCr ?? null;
    case "silverLiveAumCr":
      return row.silver?.liveAumCr ?? null;
    case "silverDeltaPct":
      return row.silver?.deltaPct ?? null;
    case "silverAvgAumCr":
      return row.silver?.avgAumCr ?? null;
    case "silverCurrentAvgAumCr":
      return row.silver?.currentAvgAumCr ?? null;
    case "totalReportedAumCr":
      return row.totalReportedAumCr;
    case "totalLiveAumCr":
      return row.totalLiveAumCr;
    case "totalDeltaPct":
      return row.totalDeltaPct;
    case "totalAvgAumCr":
      return row.totalAvgAumCr;
    case "totalCurrentAvgAumCr":
      return row.totalCurrentAvgAumCr;
  }
}

function computeGroupTotal(rows: AmcEtfRow[], pick: (r: AmcEtfRow) => number | null): number | null {
  const values = rows.map(pick).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0);
}

function AumCell({
  value,
  dateIso,
  className = "",
}: {
  value: number | null | undefined;
  // Only meaningful for a LIVE figure (repriced daily) -- Reported AUM
  // callers simply omit this, since its freshness is already implied by
  // the report period shown elsewhere in the row.
  dateIso?: string | null;
  className?: string;
}) {
  return (
    <TableCell className={`text-right tabular-nums ${className}`}>
      {value != null ? (
        <div className="leading-tight">
          <div>{formatCr(value)}</div>
          {dateIso && <div className="text-[10px] font-normal text-muted-foreground">{formatShortDate(dateIso)}</div>}
        </div>
      ) : (
        "—"
      )}
    </TableCell>
  );
}

function PctCell({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value == null) {
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

function GroupHeadingCell({ label, colorClass, className = "" }: { label: string; colorClass: string; className?: string }) {
  return (
    <TableHead colSpan={5} className={`text-center text-xs font-bold tracking-wide uppercase ${colorClass} ${className}`}>
      {label}
    </TableHead>
  );
}

function SortHead({
  label,
  sk,
  sortKey,
  sortDesc,
  onToggle,
  className = "",
}: {
  label: string;
  sk: SortKey;
  sortKey: SortKey;
  sortDesc: boolean;
  onToggle: (key: SortKey) => void;
  className?: string;
}) {
  const active = sk === sortKey;
  return (
    <TableHead className={`text-right align-bottom ${className}`}>
      <button type="button" onClick={() => onToggle(sk)} className="hover:text-foreground">
        {label}
        {active ? (sortDesc ? " ↓" : " ↑") : ""}
      </button>
    </TableHead>
  );
}

export function EtfTable() {
  const { data, error, isLoading } = useEtfLiveAum();
  const { data: avgAumData } = useEtfAverageAum();
  const { data: mcxData } = useMcxReference();
  const [sortKey, setSortKey] = useState<SortKey>("totalLiveAumCr");
  const [sortDesc, setSortDesc] = useState(true);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const schemes = useMemo(
    () => mergeAverageAum(data?.schemes ?? [], avgAumData?.avgAumByScheme, avgAumData?.currentAvgAumByScheme),
    [data, avgAumData]
  );
  const rows = useMemo(() => groupByAmc(schemes), [schemes]);
  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [rows, sortKey, sortDesc]);

  const goldCount = rows.filter((r) => r.gold).length;
  const silverCount = rows.filter((r) => r.silver).length;
  const totalGoldReported = computeGroupTotal(rows, (r) => r.gold?.reportedAumCr ?? null);
  const totalGoldLive = computeGroupTotal(rows, (r) => r.gold?.liveAumCr ?? null);
  const totalGoldDeltaPct =
    totalGoldReported !== null && totalGoldLive !== null && totalGoldReported !== 0
      ? (totalGoldLive - totalGoldReported) / totalGoldReported
      : null;
  const totalGoldAvg = computeGroupTotal(rows, (r) => r.gold?.avgAumCr ?? null);
  const totalGoldCurrentAvg = computeGroupTotal(rows, (r) => r.gold?.currentAvgAumCr ?? null);
  const totalSilverReported = computeGroupTotal(rows, (r) => r.silver?.reportedAumCr ?? null);
  const totalSilverLive = computeGroupTotal(rows, (r) => r.silver?.liveAumCr ?? null);
  const totalSilverDeltaPct =
    totalSilverReported !== null && totalSilverLive !== null && totalSilverReported !== 0
      ? (totalSilverLive - totalSilverReported) / totalSilverReported
      : null;
  const totalSilverAvg = computeGroupTotal(rows, (r) => r.silver?.avgAumCr ?? null);
  const totalSilverCurrentAvg = computeGroupTotal(rows, (r) => r.silver?.currentAvgAumCr ?? null);
  const grandReported = computeGroupTotal(rows, (r) => r.totalReportedAumCr);
  const grandLive = computeGroupTotal(rows, (r) => r.totalLiveAumCr);
  const grandDeltaPct =
    grandReported !== null && grandLive !== null && grandReported !== 0 ? (grandLive - grandReported) / grandReported : null;
  const grandAvg = computeGroupTotal(rows, (r) => r.totalAvgAumCr);
  const grandCurrentAvg = computeGroupTotal(rows, (r) => r.totalCurrentAvgAumCr);
  const totalGoldLiveDate = oldestDate(rows.map((r) => r.gold?.liveNavDate));
  const totalSilverLiveDate = oldestDate(rows.map((r) => r.silver?.liveNavDate));
  const grandLiveDate = oldestDate(rows.map((r) => r.totalLiveNavDate));

  useRegisterExport(() => ({
    fileName: `gold-silver-etfs-${new Date().toISOString().slice(0, 10)}`,
    sheetName: "Gold & Silver ETFs",
    rows: [
      ...sorted.map((r) => ({
        AMC: r.amc,
        "Gold Reported AUM (Cr)": r.gold?.reportedAumCr ?? null,
        "Gold Live AUM (Cr)": r.gold?.liveAumCr ?? null,
        "Gold Exit AUM QoQ Change (%)": r.gold?.deltaPct != null ? r.gold.deltaPct * 100 : null,
        "Gold Avg AUM (Cr)": r.gold?.avgAumCr ?? null,
        "Gold Avg Live AUM (Cr)": r.gold?.currentAvgAumCr ?? null,
        "Silver Reported AUM (Cr)": r.silver?.reportedAumCr ?? null,
        "Silver Live AUM (Cr)": r.silver?.liveAumCr ?? null,
        "Silver Exit AUM QoQ Change (%)": r.silver?.deltaPct != null ? r.silver.deltaPct * 100 : null,
        "Silver Avg AUM (Cr)": r.silver?.avgAumCr ?? null,
        "Silver Avg Live AUM (Cr)": r.silver?.currentAvgAumCr ?? null,
        "Total Reported AUM (Cr)": r.totalReportedAumCr,
        "Total Live AUM (Cr)": r.totalLiveAumCr,
        "Total Exit AUM QoQ Change (%)": r.totalDeltaPct != null ? r.totalDeltaPct * 100 : null,
        "Total Avg AUM (Cr)": r.totalAvgAumCr,
        "Total Avg Live AUM (Cr)": r.totalCurrentAvgAumCr,
      })),
      // MCX Gold/Silver reference rows -- own dedicated price columns
      // (not the AUM-in-Cr ones above, which would misleadingly imply
      // these are crore figures rather than a per-unit price).
      ...(mcxData?.rows ?? []).map((row) => ({
        AMC: row.contractExpiryDate
          ? `${row.displayName} (${formatReportPeriodLabel(row.contractExpiryDate.slice(0, 7))})`
          : row.displayName,
        "Gold Reported AUM (Cr)": null,
        "Gold Live AUM (Cr)": null,
        "Gold Exit AUM QoQ Change (%)": null,
        "Gold Avg AUM (Cr)": null,
        "Gold Avg Live AUM (Cr)": null,
        "Silver Reported AUM (Cr)": null,
        "Silver Live AUM (Cr)": null,
        "Silver Exit AUM QoQ Change (%)": null,
        "Silver Avg AUM (Cr)": null,
        "Silver Avg Live AUM (Cr)": null,
        "Total Reported AUM (Cr)": null,
        "Total Live AUM (Cr)": null,
        "Total Exit AUM QoQ Change (%)": null,
        "Total Avg AUM (Cr)": null,
        "Total Avg Live AUM (Cr)": null,
        [`MCX Price Quarter-End (₹/${row.unit})`]: row.quarterEndPriceInr,
        [`MCX Price Live (₹/${row.unit})`]: row.livePriceInr,
        "MCX QoQ Change (%)": row.deltaPct != null ? row.deltaPct * 100 : null,
      })),
    ],
  }));

  if (error) {
    return <p className="text-sm text-destructive">Failed to load ETF data: {error.message}</p>;
  }

  if (isLoading && !data) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  const headProps = { sortKey, sortDesc, onToggle: toggleSort };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Each AMC&apos;s Gold and Silver ETF AUM as officially disclosed by AMFI for its most recent quarter, repriced
        live using each scheme&apos;s own daily NAV movement since then (assumes units outstanding held roughly
        constant since that disclosure — the same assumption the equity Overview tab makes for share counts). Avg AUM
        and Avg Live AUM are the real daily-AUM-based averages (prior fiscal quarter, and current fiscal
        quarter-to-date) — the same two windows the equity Overview table shows — built from each scheme&apos;s own
        real month-end Exit AUM figures rolled forward day by day on that scheme&apos;s own NAV return, with any gap
        against the next real figure spread evenly across the days in between as net flow. An AMC without a fund in
        one asset class shows &quot;—&quot; in that half; Total still reflects whichever class it does have. The MCX
        Gold/Silver rows at the bottom cross-check the Live AUM return against the underlying metal&apos;s own price
        move (hover the row name for how that&apos;s calculated).
      </p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <GroupHeadingCell label="Gold ETF" colorClass="text-amber-800 dark:text-amber-400" className={GROUP_DIVIDER_CLASS} />
              <GroupHeadingCell label="Silver ETF" colorClass="text-slate-600 dark:text-slate-300" className={GROUP_DIVIDER_CLASS} />
              <GroupHeadingCell label="Total (Gold + Silver)" colorClass="text-[var(--toolbar-accent)]" />
            </TableRow>
            <TableRow>
              <TableHead className="align-bottom">
                <button type="button" onClick={() => toggleSort("amc")} className="hover:text-foreground">
                  AMC
                  {sortKey === "amc" ? (sortDesc ? " ↓" : " ↑") : ""}
                </button>
              </TableHead>
              <SortHead label="Reported AUM" sk="goldReportedAumCr" {...headProps} />
              <SortHead label="Live AUM" sk="goldLiveAumCr" {...headProps} />
              <SortHead label="QoQ Change" sk="goldDeltaPct" {...headProps} />
              <SortHead label="Avg AUM" sk="goldAvgAumCr" {...headProps} />
              <SortHead label="Avg Live AUM" sk="goldCurrentAvgAumCr" {...headProps} className={GROUP_DIVIDER_CLASS} />
              <SortHead label="Reported AUM" sk="silverReportedAumCr" {...headProps} />
              <SortHead label="Live AUM" sk="silverLiveAumCr" {...headProps} />
              <SortHead label="QoQ Change" sk="silverDeltaPct" {...headProps} />
              <SortHead label="Avg AUM" sk="silverAvgAumCr" {...headProps} />
              <SortHead label="Avg Live AUM" sk="silverCurrentAvgAumCr" {...headProps} className={GROUP_DIVIDER_CLASS} />
              <SortHead label="Reported AUM" sk="totalReportedAumCr" {...headProps} />
              <SortHead label="Live AUM" sk="totalLiveAumCr" {...headProps} />
              <SortHead label="QoQ Change" sk="totalDeltaPct" {...headProps} />
              <SortHead label="Avg AUM" sk="totalAvgAumCr" {...headProps} />
              <SortHead label="Avg Live AUM" sk="totalCurrentAvgAumCr" {...headProps} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.amc}>
                <TableCell className="font-medium">{r.amc}</TableCell>
                <AumCell value={r.gold?.reportedAumCr} />
                <AumCell value={r.gold?.liveAumCr} dateIso={r.gold?.liveNavDate} />
                <PctCell value={r.gold?.deltaPct} />
                <AumCell value={r.gold?.avgAumCr} />
                <AumCell value={r.gold?.currentAvgAumCr} className={GROUP_DIVIDER_CLASS} />
                <AumCell value={r.silver?.reportedAumCr} />
                <AumCell value={r.silver?.liveAumCr} dateIso={r.silver?.liveNavDate} />
                <PctCell value={r.silver?.deltaPct} />
                <AumCell value={r.silver?.avgAumCr} />
                <AumCell value={r.silver?.currentAvgAumCr} className={GROUP_DIVIDER_CLASS} />
                <AumCell value={r.totalReportedAumCr} className="font-medium" />
                <AumCell value={r.totalLiveAumCr} dateIso={r.totalLiveNavDate} className="font-medium" />
                <PctCell value={r.totalDeltaPct} />
                <AumCell value={r.totalAvgAumCr} className="font-medium" />
                <AumCell value={r.totalCurrentAvgAumCr} className="font-medium" />
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">
                Total ({goldCount} Gold / {silverCount} Silver AMCs)
              </TableCell>
              <AumCell value={totalGoldReported} className="font-medium" />
              <AumCell value={totalGoldLive} dateIso={totalGoldLiveDate} className="font-medium" />
              <PctCell value={totalGoldDeltaPct} />
              <AumCell value={totalGoldAvg} className="font-medium" />
              <AumCell value={totalGoldCurrentAvg} className={`font-medium ${GROUP_DIVIDER_CLASS}`} />
              <AumCell value={totalSilverReported} className="font-medium" />
              <AumCell value={totalSilverLive} dateIso={totalSilverLiveDate} className="font-medium" />
              <PctCell value={totalSilverDeltaPct} />
              <AumCell value={totalSilverAvg} className="font-medium" />
              <AumCell value={totalSilverCurrentAvg} className={`font-medium ${GROUP_DIVIDER_CLASS}`} />
              <AumCell value={grandReported} className="font-medium" />
              <AumCell value={grandLive} dateIso={grandLiveDate} className="font-medium" />
              <PctCell value={grandDeltaPct} />
              <AumCell value={grandAvg} className="font-medium" />
              <AumCell value={grandCurrentAvg} className="font-medium" />
            </TableRow>
            {mcxData?.rows.map((row) => (
              <TableRow key={row.metal} className="bg-muted/30">
                <TableCell className="font-medium" title={MCX_TITLE}>
                  {row.displayName}
                  {row.contractExpiryDate && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      ({formatReportPeriodLabel(row.contractExpiryDate.slice(0, 7))})
                    </span>
                  )}
                </TableCell>
                {row.metal === "gold" ? (
                  <>
                    <TableCell className="text-right tabular-nums">
                      {row.quarterEndPriceInr != null ? `${formatPriceInr(row.quarterEndPriceInr)}/${row.unit}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.livePriceInr != null ? `${formatPriceInr(row.livePriceInr)}/${row.unit}` : "—"}
                    </TableCell>
                    <PctCell value={row.deltaPct} />
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className={`text-right tabular-nums text-muted-foreground ${GROUP_DIVIDER_CLASS}`}>—</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className={`text-right tabular-nums text-muted-foreground ${GROUP_DIVIDER_CLASS}`}>—</TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className={`text-right tabular-nums text-muted-foreground ${GROUP_DIVIDER_CLASS}`}>—</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.quarterEndPriceInr != null ? `${formatPriceInr(row.quarterEndPriceInr)}/${row.unit}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.livePriceInr != null ? `${formatPriceInr(row.livePriceInr)}/${row.unit}` : "—"}
                    </TableCell>
                    <PctCell value={row.deltaPct} />
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className={`text-right tabular-nums text-muted-foreground ${GROUP_DIVIDER_CLASS}`}>—</TableCell>
                  </>
                )}
                <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
              </TableRow>
            ))}
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
