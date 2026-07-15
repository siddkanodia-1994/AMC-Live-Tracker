"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterExport } from "@/components/layout/export-context";
import { FieldBox } from "./field-box";
import { formatPct, formatReportPeriodLabel } from "@/lib/utils/format";
import { TOP_N_OPTIONS, type TopNOption } from "@/lib/utils/top-n";
import { useSectoralHoldings } from "@/hooks/use-sectoral-holdings";

// Sector rows default to a smaller Top-N than AMC columns (which reuse the
// shared 20-default toggle) -- 48 raw sector labels is a lot of rows to
// show at once, and the biggest ones by industry-wide value are the most
// informative starting point.
const DEFAULT_SECTOR_TOP_N: TopNOption = 15;

const selectClass =
  "w-full min-w-0 rounded-md border bg-background px-2 py-1 text-sm hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

type SortKey = string | "total";

export function SectoralHoldingsTable({ topN }: { topN: TopNOption }) {
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const { data, error, isLoading } = useSectoralHoldings(selectedPeriod ?? undefined);
  const [sectorTopN, setSectorTopN] = useState<TopNOption>(DEFAULT_SECTOR_TOP_N);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDesc, setSortDesc] = useState(false);

  const amcHeadRef = useRef<HTMLTableCellElement>(null);
  const [amcColWidth, setAmcColWidth] = useState(0);

  useEffect(() => {
    const el = amcHeadRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setAmcColWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  });

  // AMC rows: the shared Top-N toggle, ranked by reported AUM -- same
  // metric every other tab's default row order uses.
  const limitedAmcs = useMemo(() => {
    if (!data) return [];
    const ranked = [...data.amcs].sort((a, b) => b.reportedAumCr - a.reportedAumCr);
    return topN === "all" ? ranked : ranked.slice(0, topN);
  }, [data, topN]);

  // Sector columns: own Top-N, already pre-sorted by total industry value
  // descending from the API.
  const limitedSectors = useMemo(() => {
    if (!data) return [];
    return sectorTopN === "all" ? data.sectors : data.sectors.slice(0, sectorTopN);
  }, [data, sectorTopN]);

  // Total column: sums each AMC's % across exactly the sector columns
  // currently on screen -- tracks the Sectors Top-N toggle dynamically,
  // not a fixed sector count.
  const totalByAmcId = useMemo(() => {
    const map = new Map<number, number>();
    if (!data) return map;
    for (const amc of limitedAmcs) {
      let sum = 0;
      for (const sector of limitedSectors) {
        sum += data.matrix[sector]?.[amc.amcId] ?? 0;
      }
      map.set(amc.amcId, sum);
    }
    return map;
  }, [data, limitedAmcs, limitedSectors]);

  // Only re-orders the already-selected row set when a column sort is
  // active -- Top-N selection (which rows appear) and column sort (what
  // order they're shown in) are independent, same two-stage pattern as
  // every other sortable table here.
  const sortedAmcs = useMemo(() => {
    if (sortKey === null || !data) return limitedAmcs;
    const list = [...limitedAmcs];
    list.sort((a, b) => {
      const av = sortKey === "total" ? (totalByAmcId.get(a.amcId) ?? 0) : (data.matrix[sortKey]?.[a.amcId] ?? 0);
      const bv = sortKey === "total" ? (totalByAmcId.get(b.amcId) ?? 0) : (data.matrix[sortKey]?.[b.amcId] ?? 0);
      const cmp = av - bv;
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [limitedAmcs, sortKey, sortDesc, data, totalByAmcId]);

  function toggleSort(key: SortKey) {
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

  useRegisterExport(() => {
    if (!data) return null;
    return {
      fileName: `sectoral-holdings-${data.reportPeriod}`,
      sheetName: "Sectoral Holdings",
      rows: sortedAmcs.map((amc) => {
        const record: Record<string, string | number | null> = {
          AMC: amc.overviewName,
          "Total (%)": (totalByAmcId.get(amc.amcId) ?? 0) * 100,
        };
        for (const sector of limitedSectors) {
          record[`${sector} (%)`] = (data.matrix[sector]?.[amc.amcId] ?? 0) * 100;
        }
        return record;
      }),
    };
  });

  if (isLoading) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  if (error) {
    return <p className="text-center text-muted-foreground">Failed to load sectoral holdings: {error.message}</p>;
  }

  if (!data) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Each AMC&apos;s holdings as a % of its own reported AUM, by sector, for {data.reportPeriod}. Total sums the
          currently shown sector columns. Click a sector&apos;s (or Total&apos;s) column header to sort AMCs by it —
          first click descending, second ascending, third click back to the default (AUM, descending).
        </p>
        <div className="flex flex-wrap items-end gap-2.5">
          <FieldBox label="Month">
            <select
              value={data.reportPeriod}
              onChange={(e) => e.target.value && setSelectedPeriod(e.target.value)}
              className={selectClass}
            >
              {data.availableReportPeriods.map((p) => (
                <option key={p} value={p}>
                  {formatReportPeriodLabel(p)}
                </option>
              ))}
            </select>
          </FieldBox>
          <div className="flex items-center gap-1 text-sm">
            <span className="text-muted-foreground">Sectors:</span>
            {TOP_N_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSectorTopN(option)}
                className={`rounded-md px-2 py-1 ${
                  sectorTopN === option
                    ? "bg-[var(--toolbar-accent)] text-white"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option === "all" ? "All" : `Top ${option}`}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead ref={amcHeadRef} className="sticky left-0 z-10 bg-card">
                AMC
              </TableHead>
              <TableHead
                className="sticky z-10 bg-card text-right"
                style={{ left: amcColWidth }}
              >
                <button
                  type="button"
                  onClick={() => toggleSort("total")}
                  className="block w-full whitespace-nowrap text-right hover:text-foreground"
                >
                  Total
                  {sortKey === "total" ? (sortDesc ? " ↓" : " ↑") : ""}
                </button>
              </TableHead>
              {limitedSectors.map((sector) => (
                <TableHead key={sector} className="text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort(sector)}
                    className="block w-full whitespace-nowrap text-right hover:text-foreground"
                  >
                    {sector}
                    {sortKey === sector ? (sortDesc ? " ↓" : " ↑") : ""}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedAmcs.map((amc) => (
              <TableRow key={amc.amcId}>
                <TableCell className="sticky left-0 z-10 bg-card font-serif font-medium">{amc.overviewName}</TableCell>
                <TableCell
                  className="sticky z-10 bg-card text-right tabular-nums font-medium"
                  style={{ left: amcColWidth }}
                >
                  {formatPct(totalByAmcId.get(amc.amcId) ?? 0)}
                </TableCell>
                {limitedSectors.map((sector) => {
                  const value = data.matrix[sector]?.[amc.amcId] ?? 0;
                  return (
                    <TableCell key={sector} className="text-right tabular-nums">
                      {value > 0 ? formatPct(value) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
