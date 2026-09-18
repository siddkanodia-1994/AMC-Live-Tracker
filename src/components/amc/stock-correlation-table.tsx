"use client";

import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCr, formatPct, formatPriceInr, formatShortDate } from "@/lib/utils/format";
import { useAmcStockCorrelations } from "@/hooks/use-amc-stock-correlations";
import {
  trimToLastContinuousRun,
  computeMovingAverage,
  computeCorrelationStats,
  priceToAumRatioStats,
  alignSeriesByDate,
  toDatedValues,
  firstDefinedIndex,
} from "@/lib/aum/series-math";
import type { AmcStockCorrelationEntry } from "@/lib/amc-stock/correlation-summary";

interface ComputedRow {
  slug: string;
  overviewName: string;
  latestAumCr: number | null;
  latestPriceInr: number | null;
  corr: number | null;
  r2: number | null;
  fairValuePriceInr: number | null;
  ratioCv: number | null;
  upsidePct: number | null;
  aumTruncatedFromDate: string | null;
  priceTruncatedFromDate: string | null;
}

// Mirrors aum-trend-chart.tsx's own per-AMC computation exactly (same
// shared series-math helpers) so a row here always matches what that AMC's
// own AUM Trend chart shows for the same moving-average setting. Fair
// value price is the one number NOT shared with the chart: it comes from
// each aligned day's own (price ÷ AUM) ratio, not a level-vs-level
// regression (see priceToAumRatioStats' comment on why -- fitting two
// non-stationary trending series against each other is a spurious-
// regression risk; Corr/R² deliberately use returns for the same reason).
// A moving average longer than an AMC's own history leaves every value
// undefined -- that row's cells fall through to "—" the same way any
// other missing figure already does in this table.
function computeRow(entry: AmcStockCorrelationEntry, maDays: number): ComputedRow {
  const data = trimToLastContinuousRun(entry.aumHistory);
  const aumDisplay = computeMovingAverage(
    data.map((d) => d.liveAumCr),
    maDays
  );
  const priceDisplay = computeMovingAverage(
    entry.stockPriceSeries.map((p) => p.priceInr),
    maDays
  );

  const aumDated = toDatedValues(data.map((d) => d.date), aumDisplay);
  const priceDated = toDatedValues(
    entry.stockPriceSeries.map((p) => p.date),
    priceDisplay
  );

  const corrStats = computeCorrelationStats(aumDated, priceDated);
  const { xs, ys } = alignSeriesByDate(aumDated, priceDated);
  const ratioStats = priceToAumRatioStats(xs, ys);

  const latestAumCr = aumDisplay.length > 0 ? aumDisplay[aumDisplay.length - 1] ?? null : null;
  const latestPriceInr = priceDisplay.length > 0 ? priceDisplay[priceDisplay.length - 1] ?? null : null;
  const fairValuePriceInr = ratioStats && latestAumCr !== null ? ratioStats.meanRatio * latestAumCr : null;
  const upsidePct =
    fairValuePriceInr !== null && latestPriceInr !== null && latestPriceInr !== 0
      ? (fairValuePriceInr - latestPriceInr) / latestPriceInr
      : null;

  const aumFirstIdx = maDays > 1 ? firstDefinedIndex(aumDisplay) : 0;
  const priceFirstIdx = maDays > 1 ? firstDefinedIndex(priceDisplay) : 0;

  return {
    slug: entry.slug,
    overviewName: entry.overviewName,
    latestAumCr,
    latestPriceInr,
    corr: corrStats?.r ?? null,
    r2: corrStats?.r2 ?? null,
    fairValuePriceInr,
    ratioCv: ratioStats?.cv ?? null,
    upsidePct,
    aumTruncatedFromDate: aumFirstIdx > 0 ? data[aumFirstIdx].date : null,
    priceTruncatedFromDate: priceFirstIdx > 0 ? entry.stockPriceSeries[priceFirstIdx].date : null,
  };
}

const maInputClass =
  "w-16 rounded-md border bg-background px-2 py-1 text-xs hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";
const groupHeadClass = "border-l text-center text-xs font-bold tracking-wide uppercase text-muted-foreground";

export function StockCorrelationTable() {
  const { data, error, isLoading } = useAmcStockCorrelations();
  const [maDaysInput, setMaDaysInput] = useState("");
  const maDays = Math.max(1, Math.min(250, parseInt(maDaysInput, 10) || 1));

  const rows = useMemo(() => {
    if (!data) return [];
    return data.amcs.map((entry) => computeRow(entry, maDays));
  }, [data, maDays]);

  // The LATEST (most conservative) of every row's own AUM/price truncation
  // date -- from this date onward every row is guaranteed to have a value,
  // so one shared caption is accurate for the whole table instead of
  // repeating a possibly-different note per row.
  const truncatedFromDate = useMemo(() => {
    if (maDays <= 1) return null;
    const dates = rows
      .flatMap((r) => [r.aumTruncatedFromDate, r.priceTruncatedFromDate])
      .filter((d): d is string => d !== null);
    if (dates.length === 0) return null;
    return dates.reduce((max, d) => (d > max ? d : max));
  }, [rows, maDays]);

  if (error) {
    return <p className="text-sm text-destructive">Failed to load stock correlation data: {error.message}</p>;
  }
  if (isLoading && !data) {
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          All 8 AMCs with their own listed share price. Corr/R² use day-over-day % changes (matches each
          AMC&apos;s own AUM Trend chart), recalculated for every row from the single moving-average input here.
          Fair value price comes from each day&apos;s own (share price ÷ Live AUM) ratio — its historical average
          times today&apos;s AUM — rather than a level-vs-level regression, which would spuriously overstate the fit
          since both series trend upward over time.
        </p>
        <div className="flex items-center gap-2">
          <label htmlFor="summary-ma-days" className="text-xs text-muted-foreground">
            Moving avg (days)
          </label>
          <input
            id="summary-ma-days"
            type="number"
            min={0}
            max={250}
            value={maDaysInput}
            onChange={(e) => setMaDaysInput(e.target.value)}
            placeholder="0"
            className={maInputClass}
          />
        </div>
      </div>
      {truncatedFromDate && (
        <p className="text-xs text-muted-foreground">
          Showing values from {formatShortDate(truncatedFromDate)} ({maDays}D avg) — a full {maDays}-day window
          doesn&apos;t exist before then. An AMC with less history than that shows &quot;—&quot; until enough
          accumulates.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead colSpan={2} className="text-center text-xs font-bold tracking-wide uppercase text-muted-foreground">
                Latest (as shown)
              </TableHead>
              <TableHead colSpan={2} className={groupHeadClass}>
                Actual (returns)
              </TableHead>
              <TableHead colSpan={2} className={groupHeadClass}>
                Fair value
              </TableHead>
            </TableRow>
            <TableRow>
              <TableHead className="align-bottom">AMC</TableHead>
              <TableHead className="text-right align-bottom">Live AUM</TableHead>
              <TableHead className="text-right align-bottom">Share Price</TableHead>
              <TableHead className="border-l text-right align-bottom">Corr</TableHead>
              <TableHead className="text-right align-bottom">R²</TableHead>
              <TableHead className="border-l text-right align-bottom">Fair value price</TableHead>
              <TableHead className="text-right align-bottom">Upside %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.slug}>
                <TableCell className="font-medium">{row.overviewName}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.latestAumCr !== null ? formatCr(row.latestAumCr) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.latestPriceInr !== null ? formatPriceInr(row.latestPriceInr) : "—"}
                </TableCell>
                <TableCell className="border-l text-right tabular-nums">
                  {row.corr !== null ? (
                    <span
                      className={row.corr >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}
                    >
                      {formatPct(row.corr, { alwaysSign: true })}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.r2 !== null ? formatPct(row.r2) : "—"}</TableCell>
                <TableCell className="border-l text-right tabular-nums">
                  {row.fairValuePriceInr !== null ? (
                    <div className="leading-tight">
                      <div>{formatPriceInr(row.fairValuePriceInr)}</div>
                      <div className="text-[10px] font-normal text-muted-foreground">
                        ±{row.ratioCv !== null ? formatPct(row.ratioCv) : "—"} typical variation
                      </div>
                    </div>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.upsidePct !== null ? (
                    <span
                      className={
                        row.upsidePct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                      }
                    >
                      {formatPct(row.upsidePct, { alwaysSign: true })}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
