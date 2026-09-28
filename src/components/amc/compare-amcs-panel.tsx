"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCompareAmcs, type CompareAmcEntry } from "@/hooks/use-compare-amcs";
import { formatCr, formatPct } from "@/lib/utils/format";
import type { AmcSwitcherEntry } from "@/lib/aum/history";
import type { HoldingLiveView } from "@/lib/aum/types";

const TOP_N = 20;
const MAX_AMCS = 5;

const addSelectClass =
  "min-w-0 max-w-[220px] rounded-md border border-dashed bg-background px-2 py-1 text-sm text-muted-foreground hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

interface RankedHolding extends HoldingLiveView {
  rank: number;
}

function topHoldings(holdings: HoldingLiveView[]): RankedHolding[] {
  return [...holdings]
    .sort((a, b) => b.liveMarketValueCr - a.liveMarketValueCr)
    .slice(0, TOP_N)
    .map((h, i) => ({ ...h, rank: i + 1 }));
}

// New tab on each AMC's own detail page: pick 2-5 AMCs and see each one's
// own Top 20 holdings ranked independently side by side (NOT a merged
// cross-tab -- rank #1 is very likely a different company per AMC). See the
// "Compare AMCs" plan for the full design rationale/history.
export function CompareAmcsPanel({
  anchorSlug,
  switcherAmcs,
}: {
  anchorSlug: string;
  switcherAmcs: AmcSwitcherEntry[];
}) {
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([anchorSlug]);
  const { data, error, isLoading } = useCompareAmcs(selectedSlugs);

  const nameBySlug = useMemo(() => new Map(switcherAmcs.map((a) => [a.slug, a.overviewName])), [switcherAmcs]);
  const availableToAdd = useMemo(
    () => switcherAmcs.filter((a) => !selectedSlugs.includes(a.slug)),
    [switcherAmcs, selectedSlugs]
  );

  function addAmc(slug: string) {
    if (!slug || selectedSlugs.includes(slug) || selectedSlugs.length >= MAX_AMCS) return;
    setSelectedSlugs((prev) => [...prev, slug]);
  }

  function removeAmc(slug: string) {
    setSelectedSlugs((prev) => prev.filter((s) => s !== slug));
  }

  // Top-20 lists per selected AMC -- computed once here so both the panels
  // themselves and the overlap-count pass below read the exact same ranked
  // lists (re-sorting independently in two places could disagree at the
  // rank-20 boundary if values tie).
  const topBySlug = useMemo(() => {
    const map = new Map<string, RankedHolding[]>();
    for (const entry of data?.amcs ?? []) {
      map.set(entry.slug, topHoldings(entry.holdings));
    }
    return map;
  }, [data]);

  // How many of the *currently selected* AMCs' own Top-20 lists a given ISIN
  // appears in -- powers the ×N overlap badge. Matched by ISIN, not company
  // name (the reliable unique key on HoldingLiveView). Cash/repo line items
  // have no ISIN and are simply never counted, since there's no reliable
  // identity to match e.g. "Tri-Party Repo" across two AMCs by.
  const overlapCountByIsin = useMemo(() => {
    const counts = new Map<string, number>();
    for (const list of topBySlug.values()) {
      const seenInThisAmc = new Set<string>();
      for (const h of list) {
        if (!h.isin || seenInThisAmc.has(h.isin)) continue;
        seenInThisAmc.add(h.isin);
        counts.set(h.isin, (counts.get(h.isin) ?? 0) + 1);
      }
    }
    return counts;
  }, [topBySlug]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Comparing</span>
        {selectedSlugs.map((slug) => (
          <span
            key={slug}
            className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs font-medium"
          >
            {nameBySlug.get(slug) ?? slug}
            <button
              type="button"
              onClick={() => removeAmc(slug)}
              aria-label={`Remove ${nameBySlug.get(slug) ?? slug}`}
              className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
        {selectedSlugs.length < MAX_AMCS && availableToAdd.length > 0 && (
          <select
            value=""
            onChange={(e) => addAmc(e.target.value)}
            aria-label="Add an AMC to compare"
            className={addSelectClass}
          >
            <option value="">+ Add AMC…</option>
            {availableToAdd.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.overviewName}
              </option>
            ))}
          </select>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {selectedSlugs.length}/{MAX_AMCS} AMCs · {switcherAmcs.length} tracked total
        </span>
      </div>

      {selectedSlugs.length < 2 && (
        <p className="text-sm text-muted-foreground">
          Add at least one more AMC above to compare top holdings side by side.
        </p>
      )}

      {error && selectedSlugs.length >= 2 && (
        <p className="text-sm text-destructive">Failed to load comparison: {error.message}</p>
      )}

      {isLoading && selectedSlugs.length >= 2 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(540px,100%),1fr))] gap-4">
          {selectedSlugs.map((slug) => (
            <Skeleton key={slug} className="h-96 w-full rounded-xl" />
          ))}
        </div>
      )}

      {data && selectedSlugs.length >= 2 && (
        // minmax(min(540px, 100%), 1fr): each panel wants ~540px (enough for
        // Rank/Company/Sector/Value/Wt% without internal horizontal scroll,
        // verified empirically), but the min() clamp means a single panel
        // still shrinks to fit a narrow viewport instead of forcing page-wide
        // horizontal overflow. Panels wrap to additional rows once more than
        // fit at 540px, rather than squeezing every panel into one row.
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(540px,100%),1fr))] gap-4">
          {data.amcs.map((entry) => (
            <AmcPanel
              key={entry.slug}
              entry={entry}
              top={topBySlug.get(entry.slug) ?? []}
              overlapCountByIsin={overlapCountByIsin}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AmcPanel({
  entry,
  top,
  overlapCountByIsin,
}: {
  entry: CompareAmcEntry;
  top: RankedHolding[];
  overlapCountByIsin: Map<string, number>;
}) {
  const totalValueCr = top.reduce((sum, h) => sum + h.liveMarketValueCr, 0);
  const totalWeightPct = top.reduce((sum, h) => sum + h.weightPct, 0);

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-2 border-b">
        <CardTitle className="text-sm">{entry.overviewName}</CardTitle>
        <span className="text-xs whitespace-nowrap text-muted-foreground">Top {top.length} · by value</span>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 text-center">#</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Sector</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Wt %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="border-b bg-muted/50 font-bold">
              <TableCell className="text-center text-muted-foreground">Σ</TableCell>
              <TableCell className="font-bold">Total (Top {top.length})</TableCell>
              <TableCell />
              <TableCell className="text-right tabular-nums">{formatCr(totalValueCr)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPct(totalWeightPct)}</TableCell>
            </TableRow>
            {top.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No holdings for this report period.
                </TableCell>
              </TableRow>
            )}
            {top.map((h) => {
              const overlapCount = h.isin ? (overlapCountByIsin.get(h.isin) ?? 0) : 0;
              return (
                <TableRow key={h.id}>
                  <TableCell className="text-center text-xs text-muted-foreground">{h.rank}</TableCell>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      <span className="block max-w-40 truncate" title={h.companyName}>
                        {h.companyName}
                      </span>
                      {overlapCount > 1 && (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-400"
                        >
                          ×{overlapCount}
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="block max-w-28 truncate" title={h.sector}>
                      {h.sector}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCr(h.liveMarketValueCr)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPct(h.weightPct)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
