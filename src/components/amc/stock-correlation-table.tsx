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
  ratioAtBasis,
  alignSeriesByDate,
  toDatedValues,
  firstDefinedIndex,
  RATIO_BASIS_OPTIONS,
  type RatioBasis,
} from "@/lib/aum/series-math";
import type { AmcStockCorrelationEntry } from "@/lib/amc-stock/correlation-summary";
import { FairValueExplainer } from "./fair-value-explainer";

// The AMC used as the worked example below the table -- HDFC specifically
// requested, not user-selectable (yet).
const EXPLAINER_AMC_SLUG = "hdfc-mutual-fund";

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
  // How many standard deviations today's own (price ÷ AUM) ratio sits from
  // its historical mean -- independent of the selected ratio basis, so it
  // still reads "how rich/cheap is this AMC right now" even when the basis
  // dropdown is set to +2 SD. Same sign convention as Upside %: positive =
  // today's ratio is above its own mean (price rich relative to AUM, so
  // fair value at the mean basis sits below the current price) = red;
  // negative = cheap = green.
  zScore: number | null;
  // The LATER (more conservative) of this row's own AUM/price truncation --
  // this row's own numbers are only valid from this date onward. Kept
  // per-row (not just aggregated across all 8) so an outlier AMC -- e.g.
  // one whose stock listed months after the others -- doesn't get silently
  // averaged away into a shared caption that's wrong for every other row.
  truncatedFromDate: string | null;
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
function computeRow(entry: AmcStockCorrelationEntry, maDays: number, ratioBasis: RatioBasis): ComputedRow {
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
  const selectedRatio = ratioStats ? ratioAtBasis(ratioStats, ratioBasis) : null;
  const fairValuePriceInr = selectedRatio !== null && latestAumCr !== null ? selectedRatio * latestAumCr : null;
  const upsidePct =
    fairValuePriceInr !== null && latestPriceInr !== null && latestPriceInr !== 0
      ? (fairValuePriceInr - latestPriceInr) / latestPriceInr
      : null;
  const currentRatio =
    latestAumCr !== null && latestAumCr !== 0 && latestPriceInr !== null ? latestPriceInr / latestAumCr : null;
  const zScore =
    currentRatio !== null && ratioStats && ratioStats.stdDev !== 0
      ? (currentRatio - ratioStats.meanRatio) / ratioStats.stdDev
      : null;

  const aumFirstIdx = maDays > 1 ? firstDefinedIndex(aumDisplay) : 0;
  const priceFirstIdx = maDays > 1 ? firstDefinedIndex(priceDisplay) : 0;
  const aumTruncatedFromDate = aumFirstIdx > 0 ? data[aumFirstIdx].date : null;
  const priceTruncatedFromDate = priceFirstIdx > 0 ? entry.stockPriceSeries[priceFirstIdx].date : null;

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
    zScore,
    truncatedFromDate:
      aumTruncatedFromDate && priceTruncatedFromDate
        ? aumTruncatedFromDate > priceTruncatedFromDate
          ? aumTruncatedFromDate
          : priceTruncatedFromDate
        : aumTruncatedFromDate ?? priceTruncatedFromDate,
  };
}

const maInputClass =
  "w-16 rounded-md border bg-background px-2 py-1 text-xs hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";
const ratioBasisSelectClass =
  "w-20 rounded-md border bg-background px-2 py-1 text-xs hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";
const groupHeadClass = "border-l text-center text-xs font-bold tracking-wide uppercase text-muted-foreground";

function formatZScore(z: number): string {
  return `${z >= 0 ? "+" : "−"}${Math.abs(z).toFixed(2)}σ`;
}

// Sign coloring matches Upside %'s (green = cheap/opportunity, red =
// rich/overextended); |z| >= 2 additionally gets a background pill since
// that's the threshold worth calling out at a glance in a scan of 8 rows.
function zScoreClass(z: number): string {
  const rich = z > 0;
  if (Math.abs(z) >= 2) {
    return rich
      ? "rounded px-1.5 py-0.5 font-semibold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
      : "rounded px-1.5 py-0.5 font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  }
  if (Math.abs(z) >= 1) {
    return rich ? "font-medium text-red-600 dark:text-red-400" : "font-medium text-emerald-600 dark:text-emerald-400";
  }
  return "text-muted-foreground";
}

export function StockCorrelationTable() {
  const { data, error, isLoading } = useAmcStockCorrelations();
  const [maDaysInput, setMaDaysInput] = useState("");
  const maDays = Math.max(1, Math.min(250, parseInt(maDaysInput, 10) || 1));
  const [ratioBasis, setRatioBasis] = useState<RatioBasis>("mean");
  const activeBasis = RATIO_BASIS_OPTIONS.find((o) => o.value === ratioBasis) ?? RATIO_BASIS_OPTIONS[0];

  const rows = useMemo(() => {
    if (!data) return [];
    return data.amcs.map((entry) => computeRow(entry, maDays, ratioBasis));
  }, [data, maDays, ratioBasis]);

  const explainerEntry = useMemo(() => data?.amcs.find((a) => a.slug === EXPLAINER_AMC_SLUG) ?? null, [data]);

  // Groups rows by their own truncatedFromDate and picks the date shared by
  // the MOST rows as the one general caption, calling out any row whose
  // own date differs separately -- a single AMC with much less history
  // (e.g. a stock that only listed months after the others) shouldn't drag
  // one shared caption to a date that's wrong for every other row, the way
  // taking the max/latest across all 8 rows would.
  const truncation = useMemo(() => {
    if (maDays <= 1) return null;
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (r.truncatedFromDate) counts.set(r.truncatedFromDate, (counts.get(r.truncatedFromDate) ?? 0) + 1);
    }
    if (counts.size === 0) return null;
    let commonDate = "";
    let commonCount = 0;
    for (const [date, count] of counts) {
      if (count > commonCount) {
        commonDate = date;
        commonCount = count;
      }
    }
    const exceptions = rows.filter((r) => r.truncatedFromDate && r.truncatedFromDate !== commonDate);
    return { commonDate, commonCount, exceptions };
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
          Fair value price comes from each day&apos;s own (share price ÷ Live AUM) ratio — its historical mean (or,
          via Ratio basis, mean ± 1/2 standard deviations) times today&apos;s AUM — rather than a level-vs-level
          regression, which would spuriously overstate the fit since both series trend upward over time. Z-score is
          how many standard deviations today&apos;s own ratio sits from that historical mean, highlighted when
          |z| ≥ 1 (and more strongly at ≥ 2) as notably rich or cheap relative to the AMC&apos;s own history.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="summary-ratio-basis" className="text-xs text-muted-foreground">
              Ratio basis
            </label>
            <select
              id="summary-ratio-basis"
              value={ratioBasis}
              onChange={(e) => setRatioBasis(e.target.value as RatioBasis)}
              className={ratioBasisSelectClass}
            >
              {RATIO_BASIS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
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
      </div>
      {truncation && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>
            Showing values from {formatShortDate(truncation.commonDate)} ({maDays}D avg) for {truncation.commonCount}{" "}
            of {rows.length} AMCs — a full {maDays}-day window doesn&apos;t exist before then.
          </p>
          {truncation.exceptions.map((r) => (
            <p key={r.slug}>
              {r.overviewName}: from {formatShortDate(r.truncatedFromDate!)} — shorter history available (own AUM
              and/or share-price data starts later than the others).
            </p>
          ))}
        </div>
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
              <TableHead colSpan={3} className={groupHeadClass}>
                Fair value
              </TableHead>
            </TableRow>
            <TableRow>
              <TableHead className="align-bottom">AMC</TableHead>
              <TableHead className="text-right align-bottom">Live AUM</TableHead>
              <TableHead className="text-right align-bottom">Share Price</TableHead>
              <TableHead className="border-l text-right align-bottom">Corr</TableHead>
              <TableHead className="text-right align-bottom">R²</TableHead>
              <TableHead className="border-l text-right align-bottom">
                Fair value price{activeBasis.value !== "mean" ? ` (${activeBasis.label})` : ""}
              </TableHead>
              <TableHead className="text-right align-bottom">Upside %</TableHead>
              <TableHead className="text-right align-bottom">Z-score</TableHead>
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
                <TableCell className="text-right tabular-nums">
                  {row.zScore !== null ? (
                    <span className={zScoreClass(row.zScore)}>{formatZScore(row.zScore)}</span>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {explainerEntry && <FairValueExplainer entry={explainerEntry} maDays={maDays} ratioBasis={ratioBasis} />}
    </div>
  );
}
