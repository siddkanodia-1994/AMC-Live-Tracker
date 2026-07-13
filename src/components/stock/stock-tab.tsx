"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FieldBox } from "@/components/amc/field-box";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCr, formatDeltaCr, formatPct, formatReportPeriodLabel, formatShares } from "@/lib/utils/format";
import type { StockAmcRow, StockCandidate, StockHoldingResult } from "@/lib/aum/stock-search";

const inputClass =
  "w-full min-w-0 rounded-md border bg-background px-2 py-1 text-sm hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

type SortKey = "overviewName" | "latestMarketValueCr";

function TwoTierHead({
  label,
  sublabel,
  sublabelAccent = true,
}: {
  label: string;
  sublabel?: string;
  sublabelAccent?: boolean;
}) {
  return (
    <TableHead className={`text-right first:text-left align-bottom ${sublabel ? "whitespace-normal" : ""}`}>
      {label}
      {sublabel && (
        <span className={`block font-bold ${sublabelAccent ? "text-[var(--toolbar-accent)]" : "text-foreground"}`}>
          {sublabel}
        </span>
      )}
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
  const colorClass = valueCr >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return (
    <>
      <TableCell className="text-right tabular-nums">
        <span className={colorClass}>
          {shares >= 0 ? "+" : ""}
          {formatShares(shares)}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <span className={colorClass}>{formatDeltaCr(valueCr)}</span>
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
  const [sortKey, setSortKey] = useState<SortKey>("latestMarketValueCr");
  const [sortDesc, setSortDesc] = useState(true);

  async function runSearch(q: string, isin?: string) {
    setLoading(true);
    setError(null);
    setCandidates(null);
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

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const sortedAmcs: StockAmcRow[] = result
    ? [...result.amcs].sort((a, b) => {
        let cmp: number;
        if (sortKey === "overviewName") {
          cmp = a.overviewName.localeCompare(b.overviewName);
        } else {
          cmp = (a.latestMarketValueCr ?? -1) - (b.latestMarketValueCr ?? -1);
        }
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
              onClick={() => setShowExtra((v) => !v)}
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
                    <TwoTierHead key={`sh-${p}`} label="Shares" sublabel={formatReportPeriodLabel(p)} />
                  ))}
                  <TableHead className="align-bottom text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort("latestMarketValueCr")}
                      className="hover:text-foreground"
                    >
                      Latest Value{sortKey === "latestMarketValueCr" ? (sortDesc ? " ↓" : " ↑") : ""}
                    </button>
                  </TableHead>
                  {result.periods.map((p) => (
                    <TwoTierHead key={`wt-${p}`} label="Weight %" sublabel={formatReportPeriodLabel(p)} />
                  ))}
                  {showExtra && (
                    <>
                      <TableHead className="align-bottom text-right">Sector</TableHead>
                      <TableHead className="align-bottom text-right">Mkt Cap</TableHead>
                      <TableHead className="align-bottom text-right">Rank in Portfolio</TableHead>
                      <TwoTierHead label="MoM Change" sublabel="Shares" sublabelAccent={false} />
                      <TwoTierHead label="MoM Change" sublabel="Value" sublabelAccent={false} />
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
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
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium">Industry Total ({result.amcs.length} AMCs)</TableCell>
                  {result.periods.map((p) => (
                    <TableCell key={`t-sh-${p}`} />
                  ))}
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCr(result.industryTotalLatestValueCr)}
                  </TableCell>
                  {result.periods.map((p) => (
                    <TableCell key={`t-wt-${p}`} />
                  ))}
                  {showExtra && (
                    <>
                      <TableCell />
                      <TableCell />
                      <TableCell />
                      <TableCell />
                      <TableCell />
                    </>
                  )}
                </TableRow>
              </TableFooter>
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
