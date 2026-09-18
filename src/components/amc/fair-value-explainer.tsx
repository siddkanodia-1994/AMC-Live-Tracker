"use client";

import { useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCr, formatPct, formatPriceInr, formatShortDate } from "@/lib/utils/format";
import {
  trimToLastContinuousRun,
  computeMovingAverage,
  RATIO_BASIS_OPTIONS,
  type RatioBasis,
} from "@/lib/aum/series-math";
import type { AmcStockCorrelationEntry } from "@/lib/amc-stock/correlation-summary";

interface AlignedDay {
  date: string;
  aum: number;
  price: number;
  ratio: number;
}

// Same alignment shape as buildChartData/alignSeriesByDate, but keeps the
// date on each entry (those two intentionally don't, since neither needs
// it) -- this explainer's whole point is showing individual dated rows.
function alignForDisplay(
  dates: string[],
  aumDisplay: (number | undefined)[],
  priceSeries: AmcStockCorrelationEntry["stockPriceSeries"],
  priceDisplay: (number | undefined)[]
): AlignedDay[] {
  const priceByDate = new Map<string, number>();
  priceSeries.forEach((p, i) => {
    const value = priceDisplay[i];
    if (value !== undefined) priceByDate.set(p.date, value);
  });
  const result: AlignedDay[] = [];
  dates.forEach((date, i) => {
    const aum = aumDisplay[i];
    if (aum === undefined || aum === 0) return;
    const price = priceByDate.get(date);
    if (price === undefined) return;
    result.push({ date, aum, price, ratio: price / aum });
  });
  return result;
}

const RATIO_DECIMALS = 6;

/**
 * A live worked example of the Stock Correlation tab's fair-value math,
 * for one AMC (HDFC, per the caller) -- recomputes from the SAME raw
 * history + moving-average + ratio-basis inputs the table above uses, so
 * it can never drift out of sync with what that AMC's own row shows.
 * Deliberately keeps its own alignment/stats pass (rather than accepting
 * pre-computed numbers) since it needs the individual per-day ratios for
 * the sample rows, which the table's aggregate ComputedRow doesn't carry.
 */
export function FairValueExplainer({
  entry,
  maDays,
  ratioBasis,
}: {
  entry: AmcStockCorrelationEntry;
  maDays: number;
  ratioBasis: RatioBasis;
}) {
  const aligned = useMemo(() => {
    const data = trimToLastContinuousRun(entry.aumHistory);
    const aumDisplay = computeMovingAverage(data.map((d) => d.liveAumCr), maDays);
    const priceDisplay = computeMovingAverage(entry.stockPriceSeries.map((p) => p.priceInr), maDays);
    return alignForDisplay(data.map((d) => d.date), aumDisplay, entry.stockPriceSeries, priceDisplay);
  }, [entry, maDays]);

  const basis = RATIO_BASIS_OPTIONS.find((o) => o.value === ratioBasis) ?? RATIO_BASIS_OPTIONS[0];

  if (aligned.length < 2) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Not enough overlapping history yet to walk through {entry.overviewName}&apos;s fair value calculation.
      </div>
    );
  }

  const n = aligned.length;
  const meanRatio = aligned.reduce((sum, d) => sum + d.ratio, 0) / n;
  const variance = aligned.reduce((sum, d) => sum + (d.ratio - meanRatio) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / Math.abs(meanRatio);
  const selectedRatio = meanRatio + basis.multiplier * stdDev;

  const latest = aligned[n - 1];
  const fairValue = selectedRatio * latest.aum;
  const upsidePct = (fairValue - latest.price) / latest.price;

  const head = aligned.slice(0, 3);
  const tail = aligned.slice(Math.max(3, n - 3));
  const omitted = n - head.length - tail.length;

  return (
    <details className="rounded-lg border bg-card p-4" open>
      <summary className="cursor-pointer font-medium text-foreground">
        How is {entry.overviewName}&apos;s fair value calculated? (worked example)
      </summary>
      <div className="mt-3 space-y-4 text-sm text-muted-foreground">
        <p>
          Using the same <span className="font-medium text-foreground">{n} trading days</span> currently shown
          above ({formatShortDate(aligned[0].date)} – {formatShortDate(latest.date)}
          {maDays > 1 ? `, ${maDays}D avg` : ""}): each day&apos;s own (Share Price ÷ Live AUM) ratio is computed,
          then averaged.
        </p>

        <div>
          <p className="mb-1.5 font-medium text-foreground">1. Each day&apos;s own ratio (Share Price ÷ Live AUM)</p>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Live AUM</TableHead>
                  <TableHead className="text-right">Share Price</TableHead>
                  <TableHead className="text-right">Ratio (Price ÷ AUM)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {head.map((d) => (
                  <TableRow key={d.date}>
                    <TableCell>{formatShortDate(d.date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCr(d.aum)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPriceInr(d.price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.ratio.toFixed(RATIO_DECIMALS)}</TableCell>
                  </TableRow>
                ))}
                {omitted > 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center italic text-muted-foreground">
                      ⋮ {omitted} more days, each averaged in the same way ⋮
                    </TableCell>
                  </TableRow>
                )}
                {tail.map((d) => (
                  <TableRow key={d.date}>
                    <TableCell>{formatShortDate(d.date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCr(d.aum)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPriceInr(d.price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.ratio.toFixed(RATIO_DECIMALS)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div>
          <p className="mb-1.5 font-medium text-foreground">
            2. Fair value price = selected ratio × today&apos;s Live AUM
          </p>
          <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground">
            <div className="text-muted-foreground">Mean ratio = average of all {n} daily ratios</div>
            Mean ratio = {meanRatio.toFixed(RATIO_DECIMALS)}
            <br />
            <br />
            <div className="text-muted-foreground">Standard deviation of those {n} ratios</div>
            Std dev = {stdDev.toFixed(RATIO_DECIMALS)}
            <br />
            <br />
            <div className="text-muted-foreground">
              {basis.multiplier === 0
                ? "Selected ratio (Mean) = mean ratio itself"
                : `Selected ratio (${basis.label}) = mean ${basis.multiplier > 0 ? "+" : "−"} ${Math.abs(basis.multiplier)} × std dev`}
            </div>
            Selected ratio = {meanRatio.toFixed(RATIO_DECIMALS)}
            {basis.multiplier !== 0 &&
              ` ${basis.multiplier > 0 ? "+" : "−"} ${Math.abs(basis.multiplier)} × ${stdDev.toFixed(RATIO_DECIMALS)}`}{" "}
            = {selectedRatio.toFixed(RATIO_DECIMALS)}
            <br />
            <br />
            <div className="text-muted-foreground">Fair value price = selected ratio × today&apos;s Live AUM</div>
            Fair value = {selectedRatio.toFixed(RATIO_DECIMALS)} × {formatCr(latest.aum)} ={" "}
            <span className="font-semibold text-[var(--toolbar-accent)]">{formatPriceInr(fairValue)}</span>
          </div>
        </div>

        <div>
          <p className="mb-1.5 font-medium text-foreground">
            3. &quot;±X% typical variation&quot; = coefficient of variation of the daily ratio
          </p>
          <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground">
            CV = std dev ÷ |mean ratio| = {stdDev.toFixed(RATIO_DECIMALS)} ÷ {meanRatio.toFixed(RATIO_DECIMALS)} ={" "}
            {(cv * 100).toFixed(2)}%
            <br />
            = <span className="font-semibold text-[var(--toolbar-accent)]">±{formatPct(cv)} typical variation</span>
          </div>
        </div>

        <div>
          <p className="mb-1.5 font-medium text-foreground">
            4. Upside % = fair value vs. today&apos;s actual share price
          </p>
          <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground">
            Upside % = (fair value − current price) ÷ current price
            <br />
            = ({formatPriceInr(fairValue)} − {formatPriceInr(latest.price)}) ÷ {formatPriceInr(latest.price)}
            <br />={" "}
            <span
              className={
                upsidePct >= 0
                  ? "font-semibold text-emerald-600 dark:text-emerald-400"
                  : "font-semibold text-red-600 dark:text-red-400"
              }
            >
              {formatPct(upsidePct, { alwaysSign: true })}
            </span>
          </div>
        </div>
      </div>
    </details>
  );
}
