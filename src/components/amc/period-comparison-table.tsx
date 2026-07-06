"use client";

import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCr, formatShares } from "@/lib/utils/format";
import { usePeriodComparison } from "@/hooks/use-period-comparison";
import type { PeriodComparisonRow, PeriodComparisonStatus } from "@/lib/aum/period-comparison";

type SortKey =
  | "companyName"
  | "priorShares"
  | "currentShares"
  | "shareChange"
  | "priorValueCr"
  | "currentValueCr"
  | "valueChangeCr";

const DEFAULT_SORT_KEY: SortKey = "valueChangeCr";

function StatusBadge({ status }: { status: PeriodComparisonStatus }) {
  if (status === "new_entry") {
    return (
      <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
        New entry
      </Badge>
    );
  }
  if (status === "full_exit") {
    return (
      <Badge variant="outline" className="border-red-500/40 text-red-600 dark:text-red-400">
        Full exit
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Held
    </Badge>
  );
}

function DeltaCell({ valueCr, showSign = true }: { valueCr: number; showSign?: boolean }) {
  const isFlat = Math.abs(valueCr) < 0.005;
  return (
    <TableCell className="text-right tabular-nums">
      <span
        className={cn(
          !isFlat && valueCr > 0 && "text-emerald-600 dark:text-emerald-400",
          !isFlat && valueCr < 0 && "text-red-600 dark:text-red-400"
        )}
      >
        {showSign && valueCr > 0 ? "+" : ""}
        {formatCr(valueCr)}
      </span>
    </TableCell>
  );
}

function SortableHead({
  label,
  sk,
  sortKey,
  sortDesc,
  onToggle,
}: {
  label: string;
  sk: SortKey;
  sortKey: SortKey | null;
  sortDesc: boolean;
  onToggle: (key: SortKey) => void;
}) {
  const active = sk === sortKey;
  return (
    <TableHead className="text-right">
      <button
        type="button"
        onClick={() => onToggle(sk)}
        className={`hover:text-foreground ${active ? "text-foreground font-medium" : ""}`}
      >
        {label}
        {active ? (sortDesc ? " ↓" : " ↑") : ""}
      </button>
    </TableHead>
  );
}

export function PeriodComparisonTable({ slug }: { slug: string }) {
  const { data, error, isLoading } = usePeriodComparison(slug);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = useMemo(() => {
    if (!data) return [];
    const key = sortKey ?? DEFAULT_SORT_KEY;
    const desc = sortKey === null ? true : sortDesc;
    const list = [...data.rows];
    list.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return desc ? -cmp : cmp;
    });
    return list;
  }, [data, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDesc(true);
    } else if (sortDesc) {
      setSortDesc(false);
    } else {
      setSortKey(null);
      setSortDesc(true);
    }
  }

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (error) {
    return <p className="text-center text-muted-foreground">Failed to load period comparison: {error.message}</p>;
  }

  if (!data) {
    return (
      <p className="text-center text-muted-foreground">
        Needs at least two imported report periods for this AMC to compare — only one exists so far.
      </p>
    );
  }

  const headProps = { sortKey, sortDesc, onToggle: toggleSort };

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Comparing <span className="font-medium text-foreground">{data.priorPeriod}</span> holdings to{" "}
        <span className="font-medium text-foreground">{data.currentPeriod}</span> holdings, by position. A stock this
        AMC fully exited before {data.priorPeriod} won&apos;t appear here — only changes visible across these two
        periods are shown.
      </p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead label="Company" sk="companyName" {...headProps} />
              <TableHead>Status</TableHead>
              <SortableHead label={`Shares (${data.priorPeriod})`} sk="priorShares" {...headProps} />
              <SortableHead label={`Shares (${data.currentPeriod})`} sk="currentShares" {...headProps} />
              <SortableHead label="Share Change" sk="shareChange" {...headProps} />
              <SortableHead label={`Value (${data.priorPeriod})`} sk="priorValueCr" {...headProps} />
              <SortableHead label={`Value (${data.currentPeriod})`} sk="currentValueCr" {...headProps} />
              <SortableHead label="Value Change" sk="valueChangeCr" {...headProps} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row: PeriodComparisonRow) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{row.companyName}</TableCell>
                <TableCell>
                  <StatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.priorShares !== null ? formatShares(row.priorShares) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.currentShares !== null ? formatShares(row.currentShares) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.shareChange > 0 ? "+" : ""}
                  {formatShares(row.shareChange)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.priorValueCr !== null ? formatCr(row.priorValueCr) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {row.currentValueCr !== null ? formatCr(row.currentValueCr) : "—"}
                </TableCell>
                <DeltaCell valueCr={row.valueChangeCr} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
