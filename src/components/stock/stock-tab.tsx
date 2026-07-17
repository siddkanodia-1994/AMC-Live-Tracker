"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FieldBox } from "@/components/amc/field-box";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCr, formatDeltaCr, formatPct, formatReportPeriodLabel, formatShares } from "@/lib/utils/format";
import type { StockAmcRow, StockCandidate, StockHoldingResult } from "@/lib/aum/stock-search";

const inputClass =
  "w-full min-w-0 rounded-md border bg-background px-2 py-1 text-sm hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

// Plain string keys, not a union -- per-period Shares/Weight % columns need
// one sort key per period (e.g. "shares:2026-06"), which a fixed union
// can't express without enumerating every possible period up front.
type SortKey = string;

function getSortValue(amc: StockAmcRow, key: SortKey): string | number | null {
  if (key === "overviewName") return amc.overviewName;
  if (key === "latestMarketValueCr") return amc.latestMarketValueCr;
  if (key === "sector") return amc.sector;
  if (key === "mcapClassification") return amc.mcapClassification;
  if (key === "rankInPortfolio") return amc.rankInPortfolio;
  if (key === "changeSharesLatest") return amc.changeSharesLatest;
  if (key === "changeMarketValueCrLatest") return amc.changeMarketValueCrLatest;
  if (key.startsWith("shares:")) return amc.byPeriod[key.slice("shares:".length)]?.shares ?? null;
  if (key.startsWith("weight:")) return amc.byPeriod[key.slice("weight:".length)]?.weightPct ?? null;
  return null;
}

function TwoTierHead({
  label,
  sublabel,
  sublabelAccent = true,
  sortKeyValue,
  activeSortKey,
  sortDesc,
  onToggle,
}: {
  label: string;
  sublabel?: string;
  sublabelAccent?: boolean;
  sortKeyValue: SortKey;
  activeSortKey: SortKey | null;
  sortDesc: boolean;
  onToggle: (key: SortKey) => void;
}) {
  const active = activeSortKey === sortKeyValue;
  return (
    <TableHead className={`text-right first:text-left align-bottom ${sublabel ? "whitespace-normal" : ""}`}>
      <button type="button" onClick={() => onToggle(sortKeyValue)} className="hover:text-foreground">
        {label}
        {active ? (sortDesc ? " ↓" : " ↑") : ""}
        {sublabel && (
          <span className={`block font-bold ${sublabelAccent ? "text-[var(--toolbar-accent)]" : "text-foreground"}`}>
            {sublabel}
          </span>
        )}
      </button>
    </TableHead>
  );
}

function SortableHead({
  label,
  sortKeyValue,
  activeSortKey,
  sortDesc,
  onToggle,
}: {
  label: string;
  sortKeyValue: SortKey;
  activeSortKey: SortKey | null;
  sortDesc: boolean;
  onToggle: (key: SortKey) => void;
}) {
  const active = activeSortKey === sortKeyValue;
  return (
    <TableHead className="align-bottom text-right">
      <button type="button" onClick={() => onToggle(sortKeyValue)} className="hover:text-foreground">
        {label}
        {active ? (sortDesc ? " ↓" : " ↑") : ""}
      </button>
    </TableHead>
  );
}

function ChangeCell({ shares, valueCr }: { shares: number | null; valueCr: number | null }) {
  if (shares === null || valueCr === null) {
    return (
      <>
        <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">—</TableCell>
      </>
    );
  }
  // Independent colors -- shares and value can have opposite signs (more
  // shares bought, but the price dropped enough that value still fell), so
  // sharing one color derived from only one of the two was a bug.
  const sharesColorClass = shares >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  const valueColorClass = valueCr >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return (
    <>
      <TableCell className="text-right tabular-nums">
        <span className={sharesColorClass}>
          {shares >= 0 ? "+" : ""}
          {formatShares(shares)}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <span className={valueColorClass}>{formatDeltaCr(valueCr)}</span>
      </TableCell>
    </>
  );
}

export function StockTab() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<StockCandidate[] | null>(null);
  const [result, setResult] = useState<StockHoldingResult | null>(null);
  const [showExtra, setShowExtra] = useState(false);
  // null = the API's own default order (latestMarketValueCr descending,
  // AMCs that exited before the latest period sorting last) -- also the
  // reset target on a sort column's 3rd click.
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDesc, setSortDesc] = useState(false);

  async function runSearch(q: string, isin?: string) {
    setLoading(true);
    setError(null);
    setCandidates(null);
    // A period-specific sort key (e.g. "shares:2026-03") from the previous
    // stock's own reported periods may not exist for the new one -- reset
    // to the default order rather than silently sorting by nothing.
    setSortKey(null);
    setSortDesc(false);
    try {
      const params = new URLSearchParams();
      if (isin) params.set("isin", isin);
      else params.set("q", q);
      const res = await fetch(`/api/stock/search?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Search failed");
        setResult(null);
        return;
      }
      if (body.type === "candidates") {
        setCandidates(body.candidates);
        setResult(null);
      } else {
        setResult(body.result);
      }
    } catch {
      setError("Search failed — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (query.trim()) runSearch(query.trim());
  }

  const EXTRA_COLUMN_SORT_KEYS = ["sector", "mcapClassification", "rankInPortfolio", "changeSharesLatest", "changeMarketValueCrLatest"];

  function toggleExtraColumns() {
    setShowExtra((shown) => {
      const next = !shown;
      // Never leave the table sorted by a column that's about to be
      // hidden -- same reasoning as the Overview table's own
      // toggleNetFlowColumns.
      if (!next && sortKey !== null && EXTRA_COLUMN_SORT_KEYS.includes(sortKey)) {
        setSortKey(null);
        setSortDesc(false);
      }
      return next;
    });
  }

  // Same 3-click cycle every other sortable table in this app uses: new
  // column -> descending, click again -> ascending, click a 3rd time ->
  // back to the API's own default order.
  function toggleSort(key: SortKey) {
    if (key !== sortKey) {
      setSortKey(key);
      setSortDesc(true);
    } else if (sortDesc) {
      setSortDesc(false);
    } else {
      setSortKey(null);
      setSortDesc(false);
    }
  }

  const sortedAmcs: StockAmcRow[] = result
    ? sortKey === null
      ? result.amcs
      : [...result.amcs].sort((a, b) => {
          const av = getSortValue(a, sortKey);
          const bv = getSortValue(b, sortKey);
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
          return sortDesc ? -cmp : cmp;
        })
    : [];

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-3 shadow-sm">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2.5">
          <FieldBox label="Search by company name, ISIN, or NSE/BSE code">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Reliance Industries, INE002A01018, RELIANCE"
              className={inputClass}
            />
          </FieldBox>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="rounded-md bg-[var(--toolbar-accent)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

        {candidates && candidates.length > 0 && (
          <div className="mt-3 max-w-md overflow-hidden rounded-lg border">
            {candidates.map((c) => (
              <button
                key={c.isin}
                type="button"
                onClick={() => runSearch(query, c.isin)}
                className="flex w-full items-center justify-between border-t px-3 py-2 text-left text-sm first:border-t-0 hover:bg-[var(--toolbar-accent-soft)]/40"
              >
                <span>{c.companyName}</span>
                <span className="text-xs text-muted-foreground">{c.isin}</span>
              </button>
            ))}
          </div>
        )}

        {result && (
          <p className="mt-3 text-sm text-muted-foreground">
            Showing holdings for <span className="font-medium text-foreground">{result.companyName}</span> (
            {result.isin}) · {result.amcs.length} AMC{result.amcs.length === 1 ? "" : "s"} held this stock in the
            last {result.periods.length} reported month{result.periods.length === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {result && (
        <div className="space-y-2">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={toggleExtraColumns}
              className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {showExtra ? "Hide additional columns" : "+ Show additional columns"}
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="align-bottom">
                    <button type="button" onClick={() => toggleSort("overviewName")} className="hover:text-foreground">
                      AMC{sortKey === "overviewName" ? (sortDesc ? " ↓" : " ↑") : ""}
                    </button>
                  </TableHead>
                  {result.periods.map((p) => (
                    <TwoTierHead
                      key={`sh-${p}`}
                      label="Shares"
                      sublabel={formatReportPeriodLabel(p)}
                      sortKeyValue={`shares:${p}`}
                      activeSortKey={sortKey}
                      sortDesc={sortDesc}
                      onToggle={toggleSort}
                    />
                  ))}
                  <SortableHead
                    label="Latest Value"
                    sortKeyValue="latestMarketValueCr"
                    activeSortKey={sortKey}
                    sortDesc={sortDesc}
                    onToggle={toggleSort}
                  />
                  {result.periods.map((p) => (
                    <TwoTierHead
                      key={`wt-${p}`}
                      label="Weight %"
                      sublabel={formatReportPeriodLabel(p)}
                      sortKeyValue={`weight:${p}`}
                      activeSortKey={sortKey}
                      sortDesc={sortDesc}
                      onToggle={toggleSort}
                    />
                  ))}
                  {showExtra && (
                    <>
                      <SortableHead
                        label="Sector"
                        sortKeyValue="sector"
                        activeSortKey={sortKey}
                        sortDesc={sortDesc}
                        onToggle={toggleSort}
                      />
                      <SortableHead
                        label="Mkt Cap"
                        sortKeyValue="mcapClassification"
                        activeSortKey={sortKey}
                        sortDesc={sortDesc}
                        onToggle={toggleSort}
                      />
                      <SortableHead
                        label="Rank in Portfolio"
                        sortKeyValue="rankInPortfolio"
                        activeSortKey={sortKey}
                        sortDesc={sortDesc}
                        onToggle={toggleSort}
                      />
                      <TwoTierHead
                        label="MoM Change"
                        sublabel="Shares"
                        sublabelAccent={false}
                        sortKeyValue="changeSharesLatest"
                        activeSortKey={sortKey}
                        sortDesc={sortDesc}
                        onToggle={toggleSort}
                      />
                      <TwoTierHead
                        label="MoM Change"
                        sublabel="Value"
                        sublabelAccent={false}
                        sortKeyValue="changeMarketValueCrLatest"
                        activeSortKey={sortKey}
                        sortDesc={sortDesc}
                        onToggle={toggleSort}
                      />
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="border-b bg-muted/50 font-bold">
                  <TableCell className="font-bold">Industry Total ({result.amcs.length} AMCs)</TableCell>
                  {result.periods.map((p) => (
                    <TableCell key={`t-sh-${p}`} className="text-right tabular-nums">
                      {formatShares(result.industryTotalSharesByPeriod[p] ?? 0)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">{formatCr(result.industryTotalLatestValueCr)}</TableCell>
                  {result.periods.map((p) => (
                    <TableCell key={`t-wt-${p}`} />
                  ))}
                  {showExtra && (
                    <>
                      <TableCell />
                      <TableCell />
                      <TableCell />
                      <ChangeCell
                        shares={result.industryTotalChangeSharesLatest}
                        valueCr={result.industryTotalChangeMarketValueCrLatest}
                      />
                    </>
                  )}
                </TableRow>
                {sortedAmcs.map((amc) => (
                  <TableRow key={amc.amcId}>
                    <TableCell className="font-serif font-medium">
                      <Link href={`/amc/${amc.slug}`} className="hover:underline">
                        {amc.overviewName}
                      </Link>
                    </TableCell>
                    {result.periods.map((p) => (
                      <TableCell key={`sh-${p}`} className="text-right tabular-nums">
                        {amc.byPeriod[p] ? formatShares(amc.byPeriod[p].shares) : "—"}
                      </TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">
                      {amc.latestMarketValueCr !== null ? formatCr(amc.latestMarketValueCr) : "—"}
                    </TableCell>
                    {result.periods.map((p) => (
                      <TableCell key={`wt-${p}`} className="text-right tabular-nums">
                        {amc.byPeriod[p]?.weightPct !== null && amc.byPeriod[p]?.weightPct !== undefined
                          ? formatPct(amc.byPeriod[p].weightPct as number)
                          : "—"}
                      </TableCell>
                    ))}
                    {showExtra && (
                      <>
                        <TableCell className="text-right">{amc.sector ?? "—"}</TableCell>
                        <TableCell className="text-right">{amc.mcapClassification ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {amc.rankInPortfolio !== null ? `#${amc.rankInPortfolio}` : "—"}
                        </TableCell>
                        <ChangeCell shares={amc.changeSharesLatest} valueCr={amc.changeMarketValueCrLatest} />
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {!result && !candidates && !error && (
        <p className="text-sm text-muted-foreground">Search for a stock above to see which AMCs currently hold it.</p>
      )}
    </div>
  );
}
