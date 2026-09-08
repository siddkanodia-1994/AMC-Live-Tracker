"use client";

import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterExport } from "@/components/layout/export-context";
import { formatPriceInr, formatCr, formatPct } from "@/lib/utils/format";
import { useEtfLiveAum } from "@/hooks/use-etf-live-aum";
import { useMcxReference } from "@/hooks/use-mcx-reference";
import type { EtfLiveAum } from "@/lib/etf/compute-live-aum";

// MCX Gold/Silver only trade as futures contracts (no true spot market),
// so this uses the front-month contract's own daily closes, averaged
// across each fiscal quarter -- a genuinely different calculation than
// the ETF schemes' own point-to-point NAV return above (liveNav /
// navAtPeriodEnd - 1). Treat this as a directional cross-check, not an
// exactly matched comparison -- an avg-to-avg ratio can move a different
// amount, or even a different direction, than a point-to-point one when
// a quarter has a mid-quarter spike or dip (see src/lib/mcx/compute.ts).
const MCX_TITLE =
  "Front-month MCX futures contract (no true spot market exists for gold/silver), averaged over each fiscal quarter — previous quarter vs current quarter-to-date. This is a different calculation than the ETF schemes' own point-to-point NAV return above, so treat it as a directional cross-check, not an exact match.";

interface AmcEtfRow {
  amc: string;
  gold: EtfLiveAum | null;
  silver: EtfLiveAum | null;
  totalReportedAumCr: number | null;
  totalLiveAumCr: number | null;
  totalDeltaPct: number | null;
}

type SortKey =
  | "amc"
  | "goldReportedAumCr"
  | "goldLiveAumCr"
  | "goldDeltaPct"
  | "silverReportedAumCr"
  | "silverLiveAumCr"
  | "silverDeltaPct"
  | "totalReportedAumCr"
  | "totalLiveAumCr"
  | "totalDeltaPct";

// Divider between the Gold ETF / Silver ETF / Total column groups -- same
// low-opacity treatment as the equity Overview table's GROUP_DIVIDER_CLASS,
// applied at every row type so it reads as one continuous rule.
const GROUP_DIVIDER_CLASS = "border-r border-blue-900/20 dark:border-blue-300/20";

function groupByAmc(schemes: EtfLiveAum[]): AmcEtfRow[] {
  const byAmc = new Map<string, { gold: EtfLiveAum | null; silver: EtfLiveAum | null }>();
  for (const scheme of schemes) {
    const entry = byAmc.get(scheme.amc) ?? { gold: null, silver: null };
    if (scheme.assetClass === "gold") entry.gold = scheme;
    else entry.silver = scheme;
    byAmc.set(scheme.amc, entry);
  }
  return Array.from(byAmc.entries()).map(([amc, { gold, silver }]) => {
    const hasReported = gold?.reportedAumCr != null || silver?.reportedAumCr != null;
    const hasLive = gold?.liveAumCr != null || silver?.liveAumCr != null;
    const totalReportedAumCr = hasReported ? (gold?.reportedAumCr ?? 0) + (silver?.reportedAumCr ?? 0) : null;
    const totalLiveAumCr = hasLive ? (gold?.liveAumCr ?? 0) + (silver?.liveAumCr ?? 0) : null;
    const totalDeltaPct =
      totalReportedAumCr !== null && totalLiveAumCr !== null && totalReportedAumCr !== 0
        ? (totalLiveAumCr - totalReportedAumCr) / totalReportedAumCr
        : null;
    return { amc, gold, silver, totalReportedAumCr, totalLiveAumCr, totalDeltaPct };
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
    case "silverReportedAumCr":
      return row.silver?.reportedAumCr ?? null;
    case "silverLiveAumCr":
      return row.silver?.liveAumCr ?? null;
    case "silverDeltaPct":
      return row.silver?.deltaPct ?? null;
    case "totalReportedAumCr":
      return row.totalReportedAumCr;
    case "totalLiveAumCr":
      return row.totalLiveAumCr;
    case "totalDeltaPct":
      return row.totalDeltaPct;
  }
}

function computeGroupTotal(rows: AmcEtfRow[], pick: (r: AmcEtfRow) => number | null): number | null {
  const values = rows.map(pick).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0);
}

function AumCell({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  return (
    <TableCell className={`text-right tabular-nums ${className}`}>{value != null ? formatCr(value) : "—"}</TableCell>
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
    <TableHead colSpan={3} className={`text-center text-xs font-bold tracking-wide uppercase ${colorClass} ${className}`}>
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

  const schemes = useMemo(() => data?.schemes ?? [], [data]);
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
  const totalSilverReported = computeGroupTotal(rows, (r) => r.silver?.reportedAumCr ?? null);
  const totalSilverLive = computeGroupTotal(rows, (r) => r.silver?.liveAumCr ?? null);
  const totalSilverDeltaPct =
    totalSilverReported !== null && totalSilverLive !== null && totalSilverReported !== 0
      ? (totalSilverLive - totalSilverReported) / totalSilverReported
      : null;
  const grandReported = computeGroupTotal(rows, (r) => r.totalReportedAumCr);
  const grandLive = computeGroupTotal(rows, (r) => r.totalLiveAumCr);
  const grandDeltaPct =
    grandReported !== null && grandLive !== null && grandReported !== 0 ? (grandLive - grandReported) / grandReported : null;

  useRegisterExport(() => ({
    fileName: `gold-silver-etfs-${new Date().toISOString().slice(0, 10)}`,
    sheetName: "Gold & Silver ETFs",
    rows: [
      ...sorted.map((r) => ({
        AMC: r.amc,
        "Gold Reported AUM (Cr)": r.gold?.reportedAumCr ?? null,
        "Gold Live AUM (Cr)": r.gold?.liveAumCr ?? null,
        "Gold Exit AUM QoQ Change (%)": r.gold?.deltaPct != null ? r.gold.deltaPct * 100 : null,
        "Silver Reported AUM (Cr)": r.silver?.reportedAumCr ?? null,
        "Silver Live AUM (Cr)": r.silver?.liveAumCr ?? null,
        "Silver Exit AUM QoQ Change (%)": r.silver?.deltaPct != null ? r.silver.deltaPct * 100 : null,
        "Total Reported AUM (Cr)": r.totalReportedAumCr,
        "Total Live AUM (Cr)": r.totalLiveAumCr,
        "Total Exit AUM QoQ Change (%)": r.totalDeltaPct != null ? r.totalDeltaPct * 100 : null,
      })),
      // MCX Gold/Silver reference rows -- own dedicated price columns
      // (not the AUM-in-Cr ones above, which would misleadingly imply
      // these are crore figures rather than a per-unit price).
      ...(mcxData?.rows ?? []).map((row) => ({
        AMC: row.displayName,
        "Gold Reported AUM (Cr)": null,
        "Gold Live AUM (Cr)": null,
        "Gold Exit AUM QoQ Change (%)": null,
        "Silver Reported AUM (Cr)": null,
        "Silver Live AUM (Cr)": null,
        "Silver Exit AUM QoQ Change (%)": null,
        "Total Reported AUM (Cr)": null,
        "Total Live AUM (Cr)": null,
        "Total Exit AUM QoQ Change (%)": null,
        [`MCX Price Previous Qtr Avg (₹/${row.unit})`]: row.prevQuarterAvgPriceInr,
        [`MCX Price Current Qtr Avg (₹/${row.unit})`]: row.currentQuarterAvgPriceInr,
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
        constant since that disclosure — the same assumption the equity Overview tab makes for share counts). An AMC
        without a fund in one asset class shows &quot;—&quot; in that half; Total still reflects whichever class it
        does have. The MCX Gold/Silver rows at the bottom cross-check these returns against the underlying
        metal&apos;s own price move (hover the row name for how that&apos;s calculated).
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
              <SortHead label="QoQ Change" sk="goldDeltaPct" {...headProps} className={GROUP_DIVIDER_CLASS} />
              <SortHead label="Reported AUM" sk="silverReportedAumCr" {...headProps} />
              <SortHead label="Live AUM" sk="silverLiveAumCr" {...headProps} />
              <SortHead label="QoQ Change" sk="silverDeltaPct" {...headProps} className={GROUP_DIVIDER_CLASS} />
              <SortHead label="Reported AUM" sk="totalReportedAumCr" {...headProps} />
              <SortHead label="Live AUM" sk="totalLiveAumCr" {...headProps} />
              <SortHead label="QoQ Change" sk="totalDeltaPct" {...headProps} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.amc}>
                <TableCell className="font-medium">{r.amc}</TableCell>
                <AumCell value={r.gold?.reportedAumCr} />
                <AumCell value={r.gold?.liveAumCr} />
                <PctCell value={r.gold?.deltaPct} className={GROUP_DIVIDER_CLASS} />
                <AumCell value={r.silver?.reportedAumCr} />
                <AumCell value={r.silver?.liveAumCr} />
                <PctCell value={r.silver?.deltaPct} className={GROUP_DIVIDER_CLASS} />
                <AumCell value={r.totalReportedAumCr} className="font-medium" />
                <AumCell value={r.totalLiveAumCr} className="font-medium" />
                <PctCell value={r.totalDeltaPct} />
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">
                Total ({goldCount} Gold / {silverCount} Silver AMCs)
              </TableCell>
              <AumCell value={totalGoldReported} className="font-medium" />
              <AumCell value={totalGoldLive} className="font-medium" />
              <PctCell value={totalGoldDeltaPct} className={GROUP_DIVIDER_CLASS} />
              <AumCell value={totalSilverReported} className="font-medium" />
              <AumCell value={totalSilverLive} className="font-medium" />
              <PctCell value={totalSilverDeltaPct} className={GROUP_DIVIDER_CLASS} />
              <AumCell value={grandReported} className="font-medium" />
              <AumCell value={grandLive} className="font-medium" />
              <PctCell value={grandDeltaPct} />
            </TableRow>
            {mcxData?.rows.map((row) => (
              <TableRow key={row.metal} className="bg-muted/30">
                <TableCell className="font-medium" title={MCX_TITLE}>
                  {row.displayName}
                </TableCell>
                {row.metal === "gold" ? (
                  <>
                    <TableCell className="text-right tabular-nums">
                      {row.prevQuarterAvgPriceInr != null ? `${formatPriceInr(row.prevQuarterAvgPriceInr)}/${row.unit}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.currentQuarterAvgPriceInr != null ? `${formatPriceInr(row.currentQuarterAvgPriceInr)}/${row.unit}` : "—"}
                    </TableCell>
                    <PctCell value={row.deltaPct} className={GROUP_DIVIDER_CLASS} />
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
                    <TableCell className={`text-right tabular-nums text-muted-foreground ${GROUP_DIVIDER_CLASS}`}>—</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.prevQuarterAvgPriceInr != null ? `${formatPriceInr(row.prevQuarterAvgPriceInr)}/${row.unit}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.currentQuarterAvgPriceInr != null ? `${formatPriceInr(row.currentQuarterAvgPriceInr)}/${row.unit}` : "—"}
                    </TableCell>
                    <PctCell value={row.deltaPct} className={GROUP_DIVIDER_CLASS} />
                  </>
                )}
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
