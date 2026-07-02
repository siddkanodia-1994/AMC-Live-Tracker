"use client";

import Link from "next/link";
import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCr, formatPct } from "@/lib/utils/format";
import type { AmcLiveAum } from "@/lib/aum/types";

type SortKey =
  | "overviewName"
  | "liveAumCr"
  | "avgLiveAumCr"
  | "reportedAumCr"
  | "avgVsReportedPct"
  | "holdingsCount"
  | "debtInstrumentCount"
  | "livePricedCount";

function SortableHead({
  label,
  sk,
  sortKey,
  sortDesc,
  onToggle,
}: {
  label: string;
  sk: SortKey;
  sortKey: SortKey;
  sortDesc: boolean;
  onToggle: (key: SortKey) => void;
}) {
  const active = sk === sortKey;
  return (
    <TableHead className="text-right first:text-left">
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

export function AmcTable({ amcs }: { amcs: AmcLiveAum[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("liveAumCr");
  const [sortDesc, setSortDesc] = useState(true);

  const sorted = [...amcs].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDesc ? -cmp : cmp;
  });

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const headProps = { sortKey, sortDesc, onToggle: toggleSort };

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="AMC" sk="overviewName" {...headProps} />
            <SortableHead label="Live AUM" sk="liveAumCr" {...headProps} />
            <SortableHead label="Avg AUM" sk="avgLiveAumCr" {...headProps} />
            <SortableHead label="Reported AUM (May)" sk="reportedAumCr" {...headProps} />
            <SortableHead label="Avg vs Reported" sk="avgVsReportedPct" {...headProps} />
            <SortableHead label="Holdings" sk="holdingsCount" {...headProps} />
            <SortableHead label="Debt" sk="debtInstrumentCount" {...headProps} />
            <SortableHead label="Live Priced" sk="livePricedCount" {...headProps} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((amc) => (
            <TableRow key={amc.amcId}>
              <TableCell className="font-medium">
                <Link href={`/amc/${amc.slug}`} className="hover:underline">
                  {amc.overviewName}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatCr(amc.liveAumCr)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {amc.avgLiveAumCr !== null ? formatCr(amc.avgLiveAumCr) : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatCr(amc.reportedAumCr)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {amc.avgVsReportedPct !== null ? (
                  <span
                    className={
                      amc.avgVsReportedPct >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }
                  >
                    {formatPct(amc.avgVsReportedPct, { alwaysSign: true })}
                  </span>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{amc.holdingsCount}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {amc.debtInstrumentCount}
              </TableCell>
              <TableCell className="text-right tabular-nums">{amc.livePricedCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
