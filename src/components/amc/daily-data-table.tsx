"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterExport } from "@/components/layout/export-context";
import { formatShortDate } from "@/lib/utils/format";
import { useDailyDataQuality } from "@/hooks/use-daily-data-quality";
import type { DailyDataQualityRow } from "@/lib/aum/daily-data-quality";

function rowClassName(coveragePct: number): string {
  if (coveragePct < 80) return "bg-red-500/10 text-red-700 dark:text-red-400";
  if (coveragePct < 85) return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return "";
}

function CountCell({ value }: { value: number }) {
  return <TableCell className="text-right tabular-nums">{value.toLocaleString("en-IN")}</TableCell>;
}

export function DailyDataTable() {
  const { data, error, isLoading } = useDailyDataQuality();
  const rows: DailyDataQualityRow[] = data?.rows ?? [];

  useRegisterExport(() => ({
    fileName: "daily-data-quality",
    sheetName: "Daily Data",
    rows: rows.map((r) => ({
      Date: r.snapshotDate,
      "Total Holdings": r.totalHoldings,
      "Debt Instruments": r.debtInstruments,
      "Foreign Holdings": r.foreignHoldings,
      "Non ISIN Bearing": r.nonIsinBearing,
      "INF Fund Units": r.infFundUnits,
      "Indian Stocks": r.indianStocks,
      "Live Considered": r.liveConsidered,
      "Coverage (%)": r.coveragePct,
    })),
  }));

  if (isLoading) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  if (error) {
    return <p className="text-center text-muted-foreground">Failed to load daily data quality history: {error.message}</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        One row per trading day since 1 Jan 2026, newest first: how much of that day&apos;s industry-wide holding universe actually
        got a live DHAN close, versus debt/foreign/non-ISIN/fund-unit lines that never could. Total Holdings − Debt
        Instruments − Foreign Holdings − Non ISIN Bearing − INF Fund Units = Indian Stocks; Coverage % = Live
        Considered ÷ Indian Stocks. Non ISIN Bearing covers cash-equivalent lines (Net Current Asset, Cash & Cash
        Equivalent), no-ISIN derivative/option positions, and defunct listings — excluding the handful of no-ISIN
        debt/repo lines (TREPS, Call Money, CBLO), which stay inside Debt Instruments. INF Fund Units are Indian
        ISINs prefixed &quot;INF&quot; — one AMC holding another mutual fund/ETF&apos;s units, not an individual
        stock. Every column is mutually exclusive; they sum exactly to Total Holdings. Rows below 85% are tinted
        amber, below 80% red — the same 80% floor that lights up the Overview banner. Updated automatically each
        trading day shortly after market close.
      </p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Total Holdings</TableHead>
              <TableHead className="text-right">Debt Instruments</TableHead>
              <TableHead className="text-right">Foreign Holdings</TableHead>
              <TableHead className="text-right">Non ISIN Bearing</TableHead>
              <TableHead className="text-right">INF Fund Units</TableHead>
              <TableHead className="text-right">Indian Stocks</TableHead>
              <TableHead className="text-right">Live Considered</TableHead>
              <TableHead className="text-right">Coverage %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.snapshotDate} className={rowClassName(r.coveragePct)}>
                <TableCell className="font-medium">{formatShortDate(r.snapshotDate)}</TableCell>
                <CountCell value={r.totalHoldings} />
                <CountCell value={r.debtInstruments} />
                <CountCell value={r.foreignHoldings} />
                <CountCell value={r.nonIsinBearing} />
                <CountCell value={r.infFundUnits} />
                <CountCell value={r.indianStocks} />
                <CountCell value={r.liveConsidered} />
                <TableCell className="text-right font-semibold tabular-nums">{r.coveragePct.toFixed(1)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
