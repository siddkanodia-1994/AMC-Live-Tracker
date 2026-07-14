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
  const [sortSector, setSortSector] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(false);

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

  // Only re-orders the already-selected row set when a column sort is
  // active -- Top-N selection (which rows appear) and column sort (what
  // order they're shown in) are independent, same two-stage pattern as
  // every other sortable table here.
  const sortedAmcs = useMemo(() => {
    if (sortSector === null || !data) return limitedAmcs;
    const list = [...limitedAmcs];
    list.sort((a, b) => {
      const av = data.matrix[sortSector]?.[a.amcId] ?? 0;
      const bv = data.matrix[sortSector]?.[b.amcId] ?? 0;
      const cmp = av - bv;
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [limitedAmcs, sortSector, sortDesc, data]);

  function toggleSort(sector: string) {
    if (sortSector !== sector) {
      setSortSector(sector);
      setSortDesc(true);
    } else if (sortDesc) {
      setSortDesc(false);
    } else {
      setSortSector(null);
      setSortDesc(false);
    }
  }

  useRegisterExport(() => {
    if (!data) return null;
    return {
      fileName: `sectoral-holdings-${data.reportPeriod}`,
      sheetName: "Sectoral Holdings",
      rows: sortedAmcs.map((amc) => {
        const record: Record<string, string | number | null> = { AMC: amc.overviewName };
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Each AMC&apos;s holdings as a % of its own reported AUM, by sector, for {data.reportPeriod}. Click a
          sector&apos;s column header to sort AMCs by that sector&apos;s allocation — first click descending, second
          ascending, third click back to the default (AUM, descending).
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
              <TableHead className="sticky left-0 z-10 bg-card">AMC</TableHead>
              {limitedSectors.map((sector) => (
                <TableHead key={sector} className="text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort(sector)}
                    className="block w-full whitespace-nowrap text-right hover:text-foreground"
                  >
                    {sector}
                    {sortSector === sector ? (sortDesc ? " ↓" : " ↑") : ""}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedAmcs.map((amc) => (
              <TableRow key={amc.amcId}>
                <TableCell className="sticky left-0 z-10 bg-card font-serif font-medium">{amc.overviewName}</TableCell>
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
