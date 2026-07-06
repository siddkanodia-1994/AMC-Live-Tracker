"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PriceSourceBadge } from "./price-source-badge";
import { formatCr, formatPct, formatPriceInr, formatShares } from "@/lib/utils/format";
import type { HoldingLiveView } from "@/lib/aum/types";

interface AugmentedHolding extends HoldingLiveView {
  liveVsReportedPct: number | null;
}

type SortKey =
  | "companyName"
  | "shares"
  | "reportedMarketValueCr"
  | "livePriceInr"
  | "liveMarketValueCr"
  | "liveVsReportedPct"
  | "oneDayChangePct"
  | "weightPct";

// Default view shown on load and restored on the third click of any header
// (ascending -> descending -> back to this).
const DEFAULT_SORT_KEY: SortKey = "liveMarketValueCr";

function PctCell({ value }: { value: number | null }) {
  if (value === null) {
    return <TableCell className="text-right tabular-nums">—</TableCell>;
  }
  return (
    <TableCell className="text-right tabular-nums">
      <span className={value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
        {formatPct(value, { alwaysSign: true })}
      </span>
    </TableCell>
  );
}

export function HoldingsTable({ holdings }: { holdings: HoldingLiveView[] }) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDesc, setSortDesc] = useState(true);

  const augmented: AugmentedHolding[] = useMemo(
    () =>
      holdings.map((h) => ({
        ...h,
        liveVsReportedPct: h.reportedMarketValueCr !== 0 ? h.liveMarketValueCr / h.reportedMarketValueCr - 1 : null,
      })),
    [holdings]
  );

  const sorted = useMemo(() => {
    const key = sortKey ?? DEFAULT_SORT_KEY;
    const desc = sortKey === null ? true : sortDesc;
    const list = [...augmented];
    list.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return desc ? -cmp : cmp;
    });
    return list;
  }, [augmented, sortKey, sortDesc]);

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

  const headProps = { sortKey, sortDesc, onToggle: toggleSort };

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="Company" sk="companyName" {...headProps} />
            <TableHead>Sector</TableHead>
            <TableHead>Cap</TableHead>
            <SortableHead label="Shares (May)" sk="shares" {...headProps} align="right" />
            <SortableHead label="Reported Value" sk="reportedMarketValueCr" {...headProps} align="right" />
            <SortableHead label="Live Price" sk="livePriceInr" {...headProps} align="right" />
            <SortableHead label="Live Value" sk="liveMarketValueCr" {...headProps} align="right" />
            <SortableHead label="Live vs Reported" sk="liveVsReportedPct" {...headProps} align="right" />
            <SortableHead label="1D Change" sk="oneDayChangePct" {...headProps} align="right" />
            <SortableHead label="Weight" sk="weightPct" {...headProps} align="right" />
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((h) => (
            <TableRow key={h.id}>
              <TableCell className="font-medium">{h.companyName}</TableCell>
              <TableCell className="text-muted-foreground">{h.sector}</TableCell>
              <TableCell className="text-muted-foreground">{h.mcapClassification ?? "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{formatShares(h.shares)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCr(h.reportedMarketValueCr)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {h.livePriceInr !== null ? formatPriceInr(h.livePriceInr) : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatCr(h.liveMarketValueCr)}</TableCell>
              <PctCell value={h.liveVsReportedPct} />
              <PctCell value={h.oneDayChangePct} />
              <TableCell className="text-right tabular-nums">{formatPct(h.weightPct)}</TableCell>
              <TableCell>
                <PriceSourceBadge source={h.priceSource} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHead({
  label,
  sk,
  sortKey,
  sortDesc,
  onToggle,
  align,
}: {
  label: string;
  sk: SortKey;
  sortKey: SortKey | null;
  sortDesc: boolean;
  onToggle: (key: SortKey) => void;
  align?: "right";
}) {
  const active = sk === sortKey;
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
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
