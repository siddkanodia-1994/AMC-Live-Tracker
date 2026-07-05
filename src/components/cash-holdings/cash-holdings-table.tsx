"use client";

import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPct } from "@/lib/utils/format";
import type { TopNOption } from "@/lib/utils/top-n";
import { useCashHoldings } from "@/hooks/use-cash-holdings";
import type { CashHoldingsRow } from "@/lib/aum/cash-holdings";

const DEFAULT_SORT_KEY = "overviewName";

function formatMonthLabel(month: string): string {
  const [year, mm] = month.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(mm) - 1]}-${year.slice(2)}`;
}

function getSortValue(row: CashHoldingsRow, key: string): string | number | null {
  if (key === "overviewName") return row.overviewName;
  if (key === "computedPct") return row.computedPct;
  return row.historyByMonth[key] ?? null;
}

function PctCell({ value }: { value: number | null }) {
  if (value === null) {
    return <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>;
  }
  return <TableCell className="text-right tabular-nums">{formatPct(value)}</TableCell>;
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
  sk: string;
  sortKey: string | null;
  sortDesc: boolean;
  onToggle: (key: string) => void;
  title?: string;
}) {
  const active = sk === sortKey;
  return (
    <TableHead className="text-right" title={title}>
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

export function CashHoldingsTable({ topN }: { topN: TopNOption }) {
  const { data, error, isLoading } = useCashHoldings();
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(false);

  // Top-N ranks by reported AUM in the current period -- the closest
  // available size proxy on this tab (there's no Live AUM column here),
  // matching the same "rank by whatever's available" precedent already used
  // on the AUM Growth tab. Independent of whatever column is sorted for
  // display, same as the other two tabs.
  const limited = useMemo(() => {
    if (!data) return [];
    if (topN === "all") return data.rows;
    return [...data.rows].sort((a, b) => b.reportedAumCr - a.reportedAumCr).slice(0, topN);
  }, [data, topN]);

  const sorted = useMemo(() => {
    const key = sortKey ?? DEFAULT_SORT_KEY;
    const desc = sortKey === null ? false : sortDesc;
    const list = [...limited];
    list.sort((a, b) => {
      const av = getSortValue(a, key);
      const bv = getSortValue(b, key);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return desc ? -cmp : cmp;
    });
    return list;
  }, [limited, sortKey, sortDesc]);

  function toggleSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDesc(true);
    } else if (sortDesc) {
      setSortDesc(false);
    } else {
      setSortKey(null);
      setSortDesc(false);
    }
  }

  if (isLoading) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  if (error) {
    return <p className="text-center text-muted-foreground">Failed to load cash holdings history: {error.message}</p>;
  }

  if (!data) return null;

  const headProps = { sortKey, sortDesc, onToggle: toggleSort };

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Official Cash &amp; Cash Equivalent % of AUM, as published in the source tracker&apos;s &quot;Cash Holdings&quot;
        sheet, alongside our own computed figure for {formatMonthLabel(data.currentPeriod)} — (cash equivalent + bank
        debt &amp; repo) ÷ reported AUM, using the same classification as each AMC&apos;s detail page cards. The two
        should track closely; a large gap on a given AMC is worth investigating rather than trusting blindly.
        Top-N ranks by reported AUM in {formatMonthLabel(data.currentPeriod)}.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button
                  type="button"
                  onClick={() => toggleSort("overviewName")}
                  className={`hover:text-foreground ${sortKey === "overviewName" || sortKey === null ? "font-medium text-foreground" : ""}`}
                >
                  AMC
                  {sortKey === "overviewName" || sortKey === null ? (sortDesc ? " ↓" : " ↑") : ""}
                </button>
              </TableHead>
              {data.months.map((month) => (
                <SortableHead key={month} label={formatMonthLabel(month)} sk={month} {...headProps} />
              ))}
              <SortableHead
                label={`Computed ${formatMonthLabel(data.currentPeriod)}`}
                sk="computedPct"
                {...headProps}
                title="(Cash equivalent + Bank debt & repo) / reported AUM, computed live from our own holdings classification — a cross-check against the official column for the same month, not a replacement for it."
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <TableRow key={row.amcId}>
                <TableCell className="font-medium">{row.overviewName}</TableCell>
                {data.months.map((month) => (
                  <PctCell key={month} value={row.historyByMonth[month]} />
                ))}
                <PctCell value={row.computedPct} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
