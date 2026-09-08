"use client";

import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterExport } from "@/components/layout/export-context";
import { formatCr, formatPct } from "@/lib/utils/format";
import { useEtfLiveAum } from "@/hooks/use-etf-live-aum";
import type { EtfLiveAum } from "@/lib/etf/compute-live-aum";

type SortKey = "name" | "reportedAumCr" | "liveAumCr" | "deltaPct";
type AssetClassFilter = "all" | "gold" | "silver";

function computeTotal(rows: EtfLiveAum[], key: "reportedAumCr" | "liveAumCr"): number | null {
  const values = rows.map((r) => r[key]).filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0);
}

export function EtfTable() {
  const { data, error, isLoading } = useEtfLiveAum();
  const [assetClass, setAssetClass] = useState<AssetClassFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("liveAumCr");
  const [sortDesc, setSortDesc] = useState(true);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const schemes = useMemo(() => data?.schemes ?? [], [data]);
  const filtered = useMemo(
    () => (assetClass === "all" ? schemes : schemes.filter((s) => s.assetClass === assetClass)),
    [schemes, assetClass]
  );
  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [filtered, sortKey, sortDesc]);

  const totalReportedAumCr = computeTotal(filtered, "reportedAumCr");
  const totalLiveAumCr = computeTotal(filtered, "liveAumCr");
  const totalDeltaPct =
    totalReportedAumCr !== null && totalLiveAumCr !== null && totalReportedAumCr !== 0
      ? (totalLiveAumCr - totalReportedAumCr) / totalReportedAumCr
      : null;

  useRegisterExport(() => ({
    fileName: `gold-silver-etfs-${new Date().toISOString().slice(0, 10)}`,
    sheetName: "Gold & Silver ETFs",
    rows: sorted.map((s) => ({
      Name: s.name,
      "Asset Class": s.assetClass,
      "Report Period": s.reportPeriod,
      "Reported AUM (Cr)": s.reportedAumCr,
      "Live AUM (Cr)": s.liveAumCr,
      "Exit AUM QoQ Change (%)": s.deltaPct !== null ? s.deltaPct * 100 : null,
    })),
  }));

  if (error) {
    return <p className="text-sm text-destructive">Failed to load ETF data: {error.message}</p>;
  }

  if (isLoading && !data) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  function sortHeader(key: SortKey, label: string, align: "left" | "right" = "right") {
    return (
      <TableHead
        onClick={() => toggleSort(key)}
        className={`cursor-pointer select-none ${align === "right" ? "text-right" : ""}`}
      >
        {label}
        {sortKey === key && <span className="ml-1">{sortDesc ? "↓" : "↑"}</span>}
      </TableHead>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <p className="text-muted-foreground">
          Each scheme&apos;s AUM as officially disclosed by AMFI for its most recent quarter, repriced live using
          the scheme&apos;s own daily NAV movement since then (assumes units outstanding held roughly constant since
          that disclosure — the same assumption the equity Overview tab makes for share counts).
        </p>
      </div>
      <div className="flex items-center gap-1 text-sm">
        <span className="text-muted-foreground">Show:</span>
        {(["all", "gold", "silver"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setAssetClass(option)}
            className={`rounded-md px-2 py-1 capitalize ${
              assetClass === option
                ? "bg-[var(--toolbar-accent)] text-white"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {sortHeader("name", "Scheme", "left")}
              <TableHead>Report Period</TableHead>
              {sortHeader("reportedAumCr", "Reported AUM (Cr)")}
              {sortHeader("liveAumCr", "Live AUM (Cr)")}
              {sortHeader("deltaPct", "Exit AUM QoQ Change")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((s) => (
              <TableRow key={s.schemeId}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="text-muted-foreground">{s.reportPeriod ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.reportedAumCr !== null ? formatCr(s.reportedAumCr) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {s.liveAumCr !== null ? formatCr(s.liveAumCr) : "—"}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${
                    s.deltaPct === null ? "" : s.deltaPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {s.deltaPct !== null ? formatPct(s.deltaPct, { alwaysSign: true }) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">Total ({filtered.length} schemes)</TableCell>
              <TableCell />
              <TableCell className="text-right font-medium tabular-nums">
                {totalReportedAumCr !== null ? formatCr(totalReportedAumCr) : "—"}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {totalLiveAumCr !== null ? formatCr(totalLiveAumCr) : "—"}
              </TableCell>
              <TableCell
                className={`text-right font-medium tabular-nums ${
                  totalDeltaPct === null ? "" : totalDeltaPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                }`}
              >
                {totalDeltaPct !== null ? formatPct(totalDeltaPct, { alwaysSign: true }) : "—"}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
