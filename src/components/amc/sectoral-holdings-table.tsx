"use client";

import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useRegisterExport } from "@/components/layout/export-context";
import { formatPct } from "@/lib/utils/format";
import { TOP_N_OPTIONS, type TopNOption } from "@/lib/utils/top-n";
import { useSectoralHoldings } from "@/hooks/use-sectoral-holdings";

// Sector rows default to a smaller Top-N than AMC columns (which reuse the
// shared 20-default toggle) -- 48 raw sector labels is a lot of rows to
// show at once, and the biggest ones by industry-wide value are the most
// informative starting point.
const DEFAULT_SECTOR_TOP_N: TopNOption = 15;

export function SectoralHoldingsTable({ topN }: { topN: TopNOption }) {
  const { data, error, isLoading } = useSectoralHoldings();
  const [sectorTopN, setSectorTopN] = useState<TopNOption>(DEFAULT_SECTOR_TOP_N);
  const [sortAmcId, setSortAmcId] = useState<number | null>(null);
  const [sortDesc, setSortDesc] = useState(false);

  // AMC columns: the shared Top-N toggle, ranked by reported AUM -- same
  // metric Cash Holdings already ranks by.
  const limitedAmcs = useMemo(() => {
    if (!data) return [];
    const ranked = [...data.amcs].sort((a, b) => b.reportedAumCr - a.reportedAumCr);
    return topN === "all" ? ranked : ranked.slice(0, topN);
  }, [data, topN]);

  // Sector rows: own Top-N, already pre-sorted by total industry value
  // descending from the API -- this is also the "reset to default" order.
  const limitedSectors = useMemo(() => {
    if (!data) return [];
    return sectorTopN === "all" ? data.sectors : data.sectors.slice(0, sectorTopN);
  }, [data, sectorTopN]);

  // Only re-orders the already-selected row set when a column sort is
  // active -- Top-N selection (which rows appear) and column sort (what
  // order they're shown in) are independent, same two-stage pattern as
  // every other sortable table here.
  const sortedSectors = useMemo(() => {
    if (sortAmcId === null || !data) return limitedSectors;
    const list = [...limitedSectors];
    list.sort((a, b) => {
      const av = data.matrix[a]?.[sortAmcId] ?? 0;
      const bv = data.matrix[b]?.[sortAmcId] ?? 0;
      const cmp = av - bv;
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [limitedSectors, sortAmcId, sortDesc, data]);

  function toggleSort(amcId: number) {
    if (sortAmcId !== amcId) {
      setSortAmcId(amcId);
      setSortDesc(true);
    } else if (sortDesc) {
      setSortDesc(false);
    } else {
      setSortAmcId(null);
      setSortDesc(false);
    }
  }

  useRegisterExport(() => {
    if (!data) return null;
    return {
      fileName: `sectoral-holdings-${data.reportPeriod}`,
      sheetName: "Sectoral Holdings",
      rows: sortedSectors.map((sector) => {
        const record: Record<string, string | number | null> = { Sector: sector };
        for (const amc of limitedAmcs) {
          record[`${amc.overviewName} (%)`] = (data.matrix[sector]?.[amc.amcId] ?? 0) * 100;
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Each AMC&apos;s holdings as a % of its own reported AUM, by sector, for {data.reportPeriod}. Click an
          AMC&apos;s column header to sort sectors by that AMC&apos;s allocation — first click descending, second
          ascending, third click back to the default (industry-wide total value, descending).
        </p>
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
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-card">Sector</TableHead>
              {limitedAmcs.map((amc) => (
                <TableHead key={amc.amcId} className="text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort(amc.amcId)}
                    className="whitespace-nowrap hover:text-foreground"
                  >
                    {amc.overviewName}
                    {sortAmcId === amc.amcId ? (sortDesc ? " ↓" : " ↑") : ""}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedSectors.map((sector) => (
              <TableRow key={sector}>
                <TableCell className="sticky left-0 z-10 bg-card font-medium">{sector}</TableCell>
                {limitedAmcs.map((amc) => {
                  const value = data.matrix[sector]?.[amc.amcId] ?? 0;
                  return (
                    <TableCell key={amc.amcId} className="text-right tabular-nums">
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
