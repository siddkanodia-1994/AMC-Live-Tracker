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
import { formatCr, formatDeltaCr, formatPct, formatPriceInr, formatReportPeriodLabel, formatShares } from "@/lib/utils/format";
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
  | "oneDayChangeCr"
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

// "1D MTM" -- the absolute Rupee-crore version of the same movement PctCell
// shows as a percentage. Same green-gain/red-drop convention.
function CrCell({ value }: { value: number | null }) {
  if (value === null) {
    return <TableCell className="text-right tabular-nums">—</TableCell>;
  }
  return (
    <TableCell className="text-right tabular-nums">
      <span className={value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
        {formatDeltaCr(value)}
      </span>
    </TableCell>
  );
}

export function HoldingsTable({ holdings, reportPeriod }: { holdings: HoldingLiveView[]; reportPeriod: string }) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDesc, setSortDesc] = useState(true);
  // null = show everything. Both apply together (AND) -- two independent
  // filters, each with its own "show everything" default, matching the
  // dropdowns' own "Cap"/"Sector" placeholder option.
  const [capFilter, setCapFilter] = useState<string | null>(null);
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);

  const augmented: AugmentedHolding[] = useMemo(
    () =>
      holdings.map((h) => ({
        ...h,
        liveVsReportedPct: h.reportedMarketValueCr !== 0 ? h.liveMarketValueCr / h.reportedMarketValueCr - 1 : null,
      })),
    [holdings]
  );

  // Options derived from what's actually present in this AMC's holdings --
  // never shows a Cap/Sector with zero matching rows. Computed from the
  // full unfiltered list so picking one filter doesn't shrink the other's
  // own option list.
  const capOptions = useMemo(
    () => [...new Set(augmented.map((h) => h.mcapClassification).filter((v): v is string => v !== null))].sort(),
    [augmented]
  );
  const sectorOptions = useMemo(() => [...new Set(augmented.map((h) => h.sector))].sort(), [augmented]);

  const filtered = useMemo(
    () =>
      augmented.filter(
        (h) => (capFilter === null || h.mcapClassification === capFilter) && (sectorFilter === null || h.sector === sectorFilter)
      ),
    [augmented, capFilter, sectorFilter]
  );

  const totals = useMemo(() => {
    const totalReportedValueCr = filtered.reduce((sum, h) => sum + h.reportedMarketValueCr, 0);
    const totalLiveValueCr = filtered.reduce((sum, h) => sum + h.liveMarketValueCr, 0);
    const liveVsReportedPct = totalReportedValueCr !== 0 ? totalLiveValueCr / totalReportedValueCr - 1 : null;

    // Same "filter to holdings with known prior-day data, then sum both
    // sides of the ratio" pattern amc-table.tsx already uses for the
    // AMC-level total's own 1D Change -- a holding with no prior close
    // doesn't skew the total. Previous-day value per holding is
    // back-derived from today's live value and its own price % change,
    // since shares are constant day-to-day.
    const withPrevDay = filtered.filter((h) => h.oneDayChangePct !== null && h.oneDayChangePct !== -1);
    const totalLiveValueCrWithPrevDay = withPrevDay.reduce((sum, h) => sum + h.liveMarketValueCr, 0);
    const totalPreviousDayLiveValueCr = withPrevDay.reduce(
      (sum, h) => sum + h.liveMarketValueCr / (1 + (h.oneDayChangePct as number)),
      0
    );
    const oneDayChangePct =
      totalPreviousDayLiveValueCr !== 0 ? totalLiveValueCrWithPrevDay / totalPreviousDayLiveValueCr - 1 : null;

    // Direct sum -- simpler than the percentage back-derivation above, since
    // oneDayChangeCr is already an absolute value with no divide-by-(1+pct)
    // edge case to guard against.
    const withMtm = filtered.filter((h) => h.oneDayChangeCr !== null);
    const oneDayChangeCr = withMtm.length > 0 ? withMtm.reduce((sum, h) => sum + (h.oneDayChangeCr as number), 0) : null;

    return { totalReportedValueCr, totalLiveValueCr, liveVsReportedPct, oneDayChangePct, oneDayChangeCr };
  }, [filtered]);

  const sorted = useMemo(() => {
    const key = sortKey ?? DEFAULT_SORT_KEY;
    const desc = sortKey === null ? true : sortDesc;
    const list = [...filtered];
    list.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return desc ? -cmp : cmp;
    });
    return list;
  }, [filtered, sortKey, sortDesc]);

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
            <TableHead>
              <FilterSelect label="Sector" value={sectorFilter} options={sectorOptions} onChange={setSectorFilter} />
            </TableHead>
            <TableHead>
              <FilterSelect label="Cap" value={capFilter} options={capOptions} onChange={setCapFilter} />
            </TableHead>
            <SortableHead label={`Shares (${formatReportPeriodLabel(reportPeriod)})`} sk="shares" {...headProps} align="right" />
            <SortableHead label="Reported Value" sk="reportedMarketValueCr" {...headProps} align="right" />
            <SortableHead label="Live Price" sk="livePriceInr" {...headProps} align="right" />
            <SortableHead label="Live Value" sk="liveMarketValueCr" {...headProps} align="right" />
            <SortableHead label="Live vs Reported" sk="liveVsReportedPct" {...headProps} align="right" />
            <SortableHead label="1D MTM" sk="oneDayChangeCr" {...headProps} align="right" />
            <SortableHead label="1D Change" sk="oneDayChangePct" {...headProps} align="right" />
            <SortableHead label="Weight" sk="weightPct" {...headProps} align="right" />
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow className="border-b bg-muted/50 font-bold">
            <TableCell className="font-bold">Total ({sorted.length} holdings)</TableCell>
            <TableCell />
            <TableCell />
            <TableCell />
            <TableCell className="text-right tabular-nums">{formatCr(totals.totalReportedValueCr)}</TableCell>
            <TableCell />
            <TableCell className="text-right tabular-nums">{formatCr(totals.totalLiveValueCr)}</TableCell>
            <PctCell value={totals.liveVsReportedPct} />
            <CrCell value={totals.oneDayChangeCr} />
            <PctCell value={totals.oneDayChangePct} />
            <TableCell />
            <TableCell />
          </TableRow>
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
              <CrCell value={h.oneDayChangeCr} />
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

// Replaces a plain column label with a filter dropdown -- the placeholder
// option (value="") is "show everything" for that one filter, matching the
// column's own static label (e.g. "Cap") when nothing is selected.
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={`rounded border bg-transparent px-1 py-0.5 text-sm font-medium hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40 ${
        value ? "border-[var(--toolbar-accent)] text-[var(--toolbar-accent)]" : "border-transparent"
      }`}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
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
        className="hover:text-foreground"
      >
        {label}
        {active ? (sortDesc ? " ↓" : " ↑") : ""}
      </button>
    </TableHead>
  );
}
