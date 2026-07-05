"use client";

import Link from "next/link";
import { useState } from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MarketStatusBadge } from "@/components/layout/market-status-badge";
import { formatCr, formatDeltaCr, formatPct } from "@/lib/utils/format";
import type { AmcLiveAum } from "@/lib/aum/types";

type SortKey =
  | "overviewName"
  | "liveAumCr"
  | "oneDayChangePct"
  | "avgLiveAumCr"
  | "reportedAumCr"
  | "deltaPct"
  | "avgVsReportedPct"
  | "holdingsCount"
  | "debtInstrumentCount"
  | "livePricedCount"
  | "netFlowPct";

const NET_FLOW_TITLE =
  "Reported AUM minus what AUM would be if the prior period's holdings had simply been repriced through this month-end (no trading). Conflates investor subscriptions/redemptions with the manager's own buying/selling — an approximation, not a pure flows figure. Blank until a prior period + its daily-snapshot backfill exist.";

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

function NetFlowCell({ netFlowCr, netFlowPct }: { netFlowCr: number | null; netFlowPct: number | null }) {
  if (netFlowCr === null) {
    return <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>;
  }
  return (
    <TableCell className="text-right tabular-nums" title={formatDeltaCr(netFlowCr)}>
      {netFlowPct !== null ? (
        <span className={netFlowCr >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
          {formatPct(netFlowPct, { alwaysSign: true })}
        </span>
      ) : (
        formatDeltaCr(netFlowCr)
      )}
    </TableCell>
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

export function AmcTable({
  amcs,
  distinctHoldingsCount,
  distinctDebtInstrumentCount,
  distinctLivePricedCount,
}: {
  amcs: AmcLiveAum[];
  distinctHoldingsCount: number;
  distinctDebtInstrumentCount: number;
  distinctLivePricedCount: number;
}) {
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

  const totalLiveAumCr = amcs.reduce((sum, a) => sum + a.liveAumCr, 0);
  const totalAvgAumCr = amcs.reduce((sum, a) => sum + (a.avgLiveAumCr ?? a.reportedAumCr), 0);
  const totalReportedAumCr = amcs.reduce((sum, a) => sum + a.reportedAumCr, 0);
  const totalAvgVsReportedPct = totalReportedAumCr !== 0 ? totalAvgAumCr / totalReportedAumCr - 1 : null;
  const totalLiveVsReportedPct = totalReportedAumCr !== 0 ? totalLiveAumCr / totalReportedAumCr - 1 : null;

  // Only over AMCs with a known previous-day value, so one AMC missing
  // history doesn't skew the industry-wide 1-day change.
  const withPrevDay = amcs.filter((a) => a.previousDayLiveAumCr !== null);
  const totalLiveAumCrWithPrevDay = withPrevDay.reduce((sum, a) => sum + a.liveAumCr, 0);
  const totalPreviousDayLiveAumCr = withPrevDay.reduce((sum, a) => sum + (a.previousDayLiveAumCr ?? 0), 0);
  const totalOneDayChangePct =
    totalPreviousDayLiveAumCr !== 0 ? totalLiveAumCrWithPrevDay / totalPreviousDayLiveAumCr - 1 : null;

  // Only over AMCs with a known net-flow baseline, so AMCs without a prior
  // period + backfill (e.g. brand-new funds) don't skew the industry total.
  // null (not 0) when nobody has data yet, so the footer shows "—" rather
  // than a misleading "zero flow".
  const withNetFlow = amcs.filter((a) => a.netFlowCr !== null && a.netFlowBaselineCr !== null);
  const totalNetFlowCr = withNetFlow.length > 0 ? withNetFlow.reduce((sum, a) => sum + (a.netFlowCr ?? 0), 0) : null;
  const totalNetFlowBaselineCr = withNetFlow.reduce((sum, a) => sum + (a.netFlowBaselineCr ?? 0), 0);
  const totalNetFlowPct =
    totalNetFlowCr !== null && totalNetFlowBaselineCr !== 0 ? totalNetFlowCr / totalNetFlowBaselineCr : null;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleSort("overviewName")}
                  className={`hover:text-foreground ${sortKey === "overviewName" ? "font-medium text-foreground" : ""}`}
                >
                  AMC
                  {sortKey === "overviewName" ? (sortDesc ? " ↓" : " ↑") : ""}
                </button>
                <MarketStatusBadge />
              </div>
            </TableHead>
            <SortableHead label="Live AUM" sk="liveAumCr" {...headProps} />
            <SortableHead label="1D Change" sk="oneDayChangePct" {...headProps} />
            <SortableHead label="Avg AUM" sk="avgLiveAumCr" {...headProps} />
            <SortableHead label="Reported AUM (May)" sk="reportedAumCr" {...headProps} />
            <SortableHead label="Live vs Reported" sk="deltaPct" {...headProps} />
            <SortableHead label="Avg vs Reported" sk="avgVsReportedPct" {...headProps} />
            <SortableHead label="Holdings" sk="holdingsCount" {...headProps} />
            <SortableHead label="Debt" sk="debtInstrumentCount" {...headProps} />
            <SortableHead label="Live Priced" sk="livePricedCount" {...headProps} />
            <SortableHead label="Est. Net Flow" sk="netFlowPct" {...headProps} title={NET_FLOW_TITLE} />
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
              <PctCell value={amc.oneDayChangePct} />
              <TableCell className="text-right tabular-nums">
                {amc.avgLiveAumCr !== null ? formatCr(amc.avgLiveAumCr) : "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatCr(amc.reportedAumCr)}
              </TableCell>
              <PctCell value={amc.deltaPct} />
              <PctCell value={amc.avgVsReportedPct} />
              <TableCell className="text-right tabular-nums">{amc.holdingsCount}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {amc.debtInstrumentCount}
              </TableCell>
              <TableCell className="text-right tabular-nums">{amc.livePricedCount}</TableCell>
              <NetFlowCell netFlowCr={amc.netFlowCr} netFlowPct={amc.netFlowPct} />
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total ({amcs.length} AMCs)</TableCell>
            <TableCell className="text-right tabular-nums">{formatCr(totalLiveAumCr)}</TableCell>
            <PctCell value={totalOneDayChangePct} />
            <TableCell className="text-right tabular-nums">{formatCr(totalAvgAumCr)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCr(totalReportedAumCr)}</TableCell>
            <PctCell value={totalLiveVsReportedPct} />
            <PctCell value={totalAvgVsReportedPct} />
            <TableCell className="text-right tabular-nums" title="Distinct stocks held anywhere in the industry — not a sum of each AMC's count">
              {distinctHoldingsCount}
            </TableCell>
            <TableCell className="text-right tabular-nums" title="Distinct debt instruments (G-Secs, bank CDs/CPs) across the industry">
              {distinctDebtInstrumentCount}
            </TableCell>
            <TableCell className="text-right tabular-nums" title="Distinct stocks currently showing a live price, industry-wide">
              {distinctLivePricedCount}
            </TableCell>
            <NetFlowCell netFlowCr={totalNetFlowCr} netFlowPct={totalNetFlowPct} />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
