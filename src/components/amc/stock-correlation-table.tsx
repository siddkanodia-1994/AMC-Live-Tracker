"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCr, formatPct, formatPriceInr, formatShortDate } from "@/lib/utils/format";
import { useAmcStockCorrelations } from "@/hooks/use-amc-stock-correlations";
import {
  trimToLastContinuousRun,
  computeMovingAverage,
  computeCorrelationStats,
  computeLevelCorrelationStats,
  priceToAumRatioStats,
  ratioAtBasis,
  alignSeriesByDate,
  RATIO_BASIS_OPTIONS,
  type RatioBasis,
} from "@/lib/aum/series-math";
import { RANGE_OPTIONS, computeRangeCutoffDate, filterByCutoff, type RangeOption } from "@/lib/aum/date-range";
import type { AmcStockCorrelationEntry } from "@/lib/amc-stock/correlation-summary";
import { FairValueExplainer } from "./fair-value-explainer";
import { AumTrendChart } from "./aum-trend-chart";

// The AMC used as the worked example below the table -- HDFC specifically
// requested, not user-selectable (yet).
const EXPLAINER_AMC_SLUG = "hdfc-mutual-fund";

interface ComputedRow {
  slug: string;
  overviewName: string;
  // The strict raw, unsmoothed, single most-recent-day value -- NEVER
  // passed through the moving average, and unaffected by either control
  // (period selector or Moving avg (days)). What a user could actually see
  // quoted "right now".
  latestAumCr: number | null;
  latestPriceInr: number | null;
  // The N-day trailing moving average ending TODAY (Moving avg (days) is
  // the only thing that drives these) -- computed over the AMC's full
  // history, independent of the period selector entirely. Identical to
  // latestAumCr/latestPriceInr whenever Moving avg (days) is 0/blank (a
  // 0-day average is just today's raw value); only visibly diverges once a
  // moving-average window is actually entered. Feeds Fair value price and
  // Z-score's "today's own ratio" (see computeRow) -- this is "the revised
  // ratio" the user asked for.
  avgAumCr: number | null;
  avgPriceInr: number | null;
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
function computeRow(
  entry: AmcStockCorrelationEntry,
  maDays: number,
  ratioBasis: RatioBasis,
  range: RangeOption,
  aumOnlyAveraging: boolean,
  levelsCorrelation: boolean
): ComputedRow {
  const data = trimToLastContinuousRun(entry.aumHistory);
  // Moving average computed over the FULL history first, then the period
  // filter applied to the resulting dated series -- so a day near the
  // start of a narrow period still gets a real N-day trailing average
  // using data from just before the period boundary, instead of an
  // artificial warm-up gap right where the selected period begins. Exactly
  // mirrors aum-trend-chart.tsx's own pipeline, so the two stay identical
  // when linked.
  const aumDisplay = computeMovingAverage(
    data.map((d) => d.liveAumCr),
    maDays
  );
  // When aumOnlyAveraging is on, share price is never smoothed -- every
  // downstream consumer (corrStats/ratioStats/avgPriceInr, which feed Fair
  // value and Z-score) is agnostic to how this array was produced, so this
  // is the ONLY line that needs to branch for the whole toggle.
  const priceDisplay = aumOnlyAveraging
    ? entry.stockPriceSeries.map((p) => p.priceInr)
    : computeMovingAverage(
        entry.stockPriceSeries.map((p) => p.priceInr),
        maDays
      );

  // Keep the moving average's possible undefined gaps through the range
  // filter (unlike toDatedValues, which would drop them immediately) so
  // truncation below can tell "gap falls before the period" (invisible)
  // apart from "gap extends into the period" (needs a caption).
  const aumWithGapsFull = data.map((d, i) => ({ date: d.date, value: aumDisplay[i] }));
  const priceWithGapsFull = entry.stockPriceSeries.map((p, i) => ({ date: p.date, value: priceDisplay[i] }));
  // ONE cutoff, anchored to the AUM series' own latest date (the same
  // reference aum-trend-chart.tsx implicitly uses, since its merged
  // ChartPoint rows are keyed by the AUM series' dates) -- applied to BOTH
  // series, rather than letting each independently derive its own cutoff
  // from its own tail. AUM and price histories don't always share the
  // exact same latest date (e.g. one can be a day fresher than the
  // other), which would otherwise silently give the two series a
  // slightly different window for "the same" selected period.
  const cutoffDate = computeRangeCutoffDate(aumWithGapsFull, range);
  const aumWithGaps = filterByCutoff(aumWithGapsFull, cutoffDate);
  const priceWithGaps = filterByCutoff(priceWithGapsFull, cutoffDate);
  // Corr/R² and the historical ratio distribution (meanRatio/stdDev below,
  // which Fair value's "selected ratio" and Z-score are measured against)
  // are scoped to the selected period. avgAumCr/avgPriceInr and
  // latestAumCr/latestPriceInr are NOT period-scoped -- see the ComputedRow
  // comments on each.
  const aumDated = aumWithGaps.filter((d): d is { date: string; value: number } => d.value !== undefined);
  const priceDated = priceWithGaps.filter((d): d is { date: string; value: number } => d.value !== undefined);

  // "Levels (no % chg)" swaps in the raw-level correlation instead of the
  // default day-over-day % change one -- same aumDated/priceDated inputs
  // either way (already reflecting the period filter and AUM-only avg).
  const corrStats = levelsCorrelation
    ? computeLevelCorrelationStats(aumDated, priceDated)
    : computeCorrelationStats(aumDated, priceDated);
  const { xs, ys } = alignSeriesByDate(aumDated, priceDated);
  const ratioStats = priceToAumRatioStats(xs, ys);

  // Raw, unsmoothed, single most-recent-day value -- never the moving
  // average. `data` is already trimToLastContinuousRun'd; the price series
  // is used as-is, matching the existing convention of never trimming it.
  const latestAumCr = data.length > 0 ? data[data.length - 1].liveAumCr : null;
  const latestPriceInr =
    entry.stockPriceSeries.length > 0 ? entry.stockPriceSeries[entry.stockPriceSeries.length - 1].priceInr : null;
  // The N-day moving average ending today -- period-independent (see
  // ComputedRow comment). Equals latestAumCr/latestPriceInr exactly when
  // maDays <= 1.
  const avgAumCr = aumDisplay.length > 0 ? aumDisplay[aumDisplay.length - 1] ?? null : null;
  const avgPriceInr = priceDisplay.length > 0 ? priceDisplay[priceDisplay.length - 1] ?? null : null;
  const selectedRatio = ratioStats ? ratioAtBasis(ratioStats, ratioBasis) : null;
  // Fair value uses the AVERAGED AUM (the "revised ratio") -- confirmed:
  // reduces noise from a single volatile day's AUM.
  const fairValuePriceInr = selectedRatio !== null && avgAumCr !== null ? selectedRatio * avgAumCr : null;
  // Upside % always compares against the RAW current price -- confirmed:
  // answers "upside from the price you could actually transact at today",
  // never a smoothed historical average.
  const upsidePct =
    fairValuePriceInr !== null && latestPriceInr !== null && latestPriceInr !== 0
      ? (fairValuePriceInr - latestPriceInr) / latestPriceInr
      : null;
  // Z-score's "today's own ratio" uses avg/avg (confirmed) -- consistent
  // with Fair value price using the averaged AUM, so both sides of the
  // ratio get the same smoothing treatment.
  const currentRatio = avgAumCr !== null && avgAumCr !== 0 && avgPriceInr !== null ? avgPriceInr / avgAumCr : null;
  const zScore =
    currentRatio !== null && ratioStats && ratioStats.stdDev !== 0
      ? (currentRatio - ratioStats.meanRatio) / ratioStats.stdDev
      : null;

  // Whenever the moving average's warm-up gap extends INTO the selected
  // period's own window, note where the row's stats actually start --
  // mirrors aum-trend-chart.tsx's own truncation-caption logic exactly, now
  // over the period-filtered series rather than the full history. A gap
  // that falls entirely before the period's own start (already warmed up
  // by the time the window begins) correctly produces no caption.
  const aumFirstIdx = maDays > 1 ? aumWithGaps.findIndex((d) => d.value !== undefined) : 0;
  // Price is never smoothed (and so never has a warm-up gap) once
  // aumOnlyAveraging is on, regardless of maDays.
  const priceFirstIdx = maDays > 1 && !aumOnlyAveraging ? priceWithGaps.findIndex((d) => d.value !== undefined) : 0;
  const aumTruncatedFromDate = aumFirstIdx > 0 ? aumWithGaps[aumFirstIdx].date : null;
  const priceTruncatedFromDate = priceFirstIdx > 0 ? priceWithGaps[priceFirstIdx].date : null;

  return {
    slug: entry.slug,
    overviewName: entry.overviewName,
    latestAumCr,
    latestPriceInr,
    avgAumCr,
    avgPriceInr,
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

// One raw SheetJS cell -- either a plain value or a LIVE FORMULA with a
// JS-computed cache alongside it. A formula cell with no cached value
// renders as an error (t="e") until Excel recalculates, so every formula
// cell here also carries the equivalent plain-JS value as its cache --
// same technique already proven in crosscheck/generate-crosscheck-excel.ts.
type ExportCellValue = { f: string; value: number | string | null } | number | string | null;

function setExportCell(ws: Record<string, unknown>, addr: string, cell: ExportCellValue): void {
  if (cell === null) return;
  if (typeof cell === "object") {
    if (cell.value === null) return;
    const isStr = typeof cell.value === "string";
    ws[addr] = { t: isStr ? "str" : "n", f: cell.f, v: cell.value };
  } else if (typeof cell === "number") {
    ws[addr] = { t: "n", v: cell };
  } else {
    ws[addr] = { t: "s", v: cell };
  }
}

function ratioBasisColumnLetter(ratioBasis: RatioBasis): string {
  switch (ratioBasis) {
    case "mean":
      return "H";
    case "+1sd":
      return "I";
    case "+2sd":
      return "J";
    case "-1sd":
      return "K";
    case "-2sd":
      return "L";
  }
}

// Builds one AMC's full worksheet -- mirrors computeRow's own alignment
// pipeline (trim, smooth AUM, smooth-or-raw price per aumOnlyAveraging,
// period cutoff) exactly, but as LIVE EXCEL FORMULAS with a JS-computed
// cache per cell, not precomputed values -- per the user's own hand-built
// HDFC template (Sept 2026 audit). Deliberately its own pass rather than
// sharing computeRow's internals, same reasoning as
// fair-value-explainer.tsx's own independent alignment: it needs per-day
// granularity computeRow's return type doesn't have.
//
// Column layout (row 1 = headers, row 2.. = data; G/O/R are blank
// spacers, matching the template):
//   A-F: Date, Live AUM, Share Price, Avg AUM, Price used for ratio, Ratio
//   H-N: Mean/SD+1/SD+2/SD-1/SD-2/SD/Z Score -- repeated every row (Z-score
//     is a genuine per-day time series; Mean/SD/bands ride along on the
//     same rows, matching the template exactly)
//   P-Q: AUM Return/Price Return -- helper columns feeding Corr's formula
//   S-V: Corr/R²/Fair value price/Upside % -- single value, row 2 only
//     (whole-period "current" stats, not a per-day series)
//
// SD uses STDEVP (population), matching the app's own displayed Z-score/
// Fair value/CV exactly -- NOT STDEV (sample), which the hand-built
// template used and which reads slightly differently. Every derived
// formula degrades to a blank cell (not an Excel error) when an AMC's own
// history is too short for the current period/Moving avg to produce a
// value at all.
//
// One accepted simplification: Avg AUM's formula window is always exactly
// `maDays` real AUM rows (AUM has no internal date gaps against itself),
// but Price used for ratio/AUM Return/Price Return/Corr's formulas walk
// `maDays`/1 SHEET rows on AUM's own date spine -- usually, but (per the
// earlier weekend-anomaly audits) not provably always, the same real
// price trading days computeMovingAverage/computeCorrelationStats would
// use on price's own independent index. The CACHED value in every cell is
// still the exact correct number from the app's own functions regardless;
// only a manual Excel recalculation after editing an input could show a
// tiny divergence, and only in a date range where AUM/price genuinely
// disagree about a trading day.
function buildAmcWorksheet(
  entry: AmcStockCorrelationEntry,
  maDays: number,
  range: RangeOption,
  aumOnlyAveraging: boolean,
  levelsCorrelation: boolean,
  ratioBasis: RatioBasis
): Record<string, unknown> {
  const ws: Record<string, unknown> = {};
  const headers: Record<string, string> = {
    A: "Date",
    B: "Live AUM (cr)",
    C: "Share Price (INR)",
    D: "Avg AUM (cr)",
    E: "Price used for ratio (INR)",
    F: "Ratio (Price / AUM)",
    H: "Mean",
    I: "SD+1",
    J: "SD+2",
    K: "SD-1",
    L: "SD-2",
    M: "SD",
    N: "Z Score",
    P: "AUM Return",
    Q: "Price Return",
    S: "Corr",
    T: "R²",
    U: "Fair value price",
    V: "Upside %",
  };
  for (const [col, label] of Object.entries(headers)) setExportCell(ws, `${col}1`, label);

  const data = trimToLastContinuousRun(entry.aumHistory);
  const aumDisplay = computeMovingAverage(
    data.map((d) => d.liveAumCr),
    maDays
  );
  const priceDisplay = aumOnlyAveraging
    ? entry.stockPriceSeries.map((p) => p.priceInr)
    : computeMovingAverage(
        entry.stockPriceSeries.map((p) => p.priceInr),
        maDays
      );
  const priceRawByDate = new Map(entry.stockPriceSeries.map((p) => [p.date, p.priceInr]));
  const priceDisplayByDate = new Map(entry.stockPriceSeries.map((p, i) => [p.date, priceDisplay[i] ?? null]));

  // AUM's own date list is the spine (matches aum-trend-chart.tsx's
  // buildChartData convention) -- price/ratio columns are looked up per
  // AUM date, blank when that date has no price. Cutoff anchored to AUM's
  // own latest date, same as computeRow.
  const aumWithGapsFull = data.map((d, i) => ({ date: d.date, liveAumCr: d.liveAumCr, avgAumCr: aumDisplay[i] ?? null }));
  const cutoffDate = computeRangeCutoffDate(aumWithGapsFull, range);
  const rangedAum = filterByCutoff(aumWithGapsFull, cutoffDate);
  const lastRow = rangedAum.length + 1;

  const alignedAum: number[] = [];
  const alignedPrice: number[] = [];
  let prevAvgAum: number | null = null;
  let prevPriceForRatio: number | null = null;

  rangedAum.forEach((point, idx) => {
    const r = idx + 2;
    const priceForRatio = priceDisplayByDate.get(point.date) ?? null;
    const rawPrice = priceRawByDate.get(point.date) ?? null;
    const ratio =
      point.avgAumCr !== null && point.avgAumCr !== 0 && priceForRatio !== null ? priceForRatio / point.avgAumCr : null;

    setExportCell(ws, `A${r}`, point.date);
    setExportCell(ws, `B${r}`, point.liveAumCr);
    setExportCell(ws, `C${r}`, rawPrice);

    if (point.avgAumCr !== null) {
      setExportCell(ws, `D${r}`, { f: `AVERAGE(B${r - maDays + 1}:B${r})`, value: point.avgAumCr });
    }
    if (priceForRatio !== null) {
      const priceFormula = aumOnlyAveraging ? `C${r}` : `AVERAGE(C${r - maDays + 1}:C${r})`;
      setExportCell(ws, `E${r}`, { f: priceFormula, value: priceForRatio });
    }
    if (ratio !== null) {
      setExportCell(ws, `F${r}`, { f: `E${r}/D${r}`, value: ratio });
      alignedAum.push(point.avgAumCr as number);
      alignedPrice.push(priceForRatio as number);
    }

    if (prevAvgAum !== null && point.avgAumCr !== null && prevAvgAum !== 0) {
      setExportCell(ws, `P${r}`, {
        f: `IF(OR(D${r}="",D${r - 1}=""),"",(D${r}-D${r - 1})/D${r - 1})`,
        value: (point.avgAumCr - prevAvgAum) / prevAvgAum,
      });
    }
    if (prevPriceForRatio !== null && priceForRatio !== null && prevPriceForRatio !== 0) {
      setExportCell(ws, `Q${r}`, {
        f: `IF(OR(E${r}="",E${r - 1}=""),"",(E${r}-E${r - 1})/E${r - 1})`,
        value: (priceForRatio - prevPriceForRatio) / prevPriceForRatio,
      });
    }
    prevAvgAum = point.avgAumCr;
    prevPriceForRatio = priceForRatio;
  });

  const ratioStats = priceToAumRatioStats(alignedAum, alignedPrice);

  rangedAum.forEach((point, idx) => {
    const r = idx + 2;
    setExportCell(ws, `H${r}`, { f: `IFERROR(AVERAGE(F:F),"")`, value: ratioStats?.meanRatio ?? "" });
    setExportCell(ws, `M${r}`, { f: `IFERROR(STDEVP(F:F),"")`, value: ratioStats?.stdDev ?? "" });
    setExportCell(ws, `I${r}`, {
      f: `IF(OR(H${r}="",M${r}=""),"",H${r}+M${r})`,
      value: ratioStats ? ratioStats.meanRatio + ratioStats.stdDev : "",
    });
    setExportCell(ws, `J${r}`, {
      f: `IF(OR(I${r}="",M${r}=""),"",I${r}+M${r})`,
      value: ratioStats ? ratioStats.meanRatio + 2 * ratioStats.stdDev : "",
    });
    setExportCell(ws, `K${r}`, {
      f: `IF(OR(H${r}="",M${r}=""),"",H${r}-M${r})`,
      value: ratioStats ? ratioStats.meanRatio - ratioStats.stdDev : "",
    });
    setExportCell(ws, `L${r}`, {
      f: `IF(OR(K${r}="",M${r}=""),"",K${r}-M${r})`,
      value: ratioStats ? ratioStats.meanRatio - 2 * ratioStats.stdDev : "",
    });

    const priceForRatio = priceDisplayByDate.get(point.date) ?? null;
    const ratio =
      point.avgAumCr !== null && point.avgAumCr !== 0 && priceForRatio !== null ? priceForRatio / point.avgAumCr : null;
    const zScoreValue =
      ratio !== null && ratioStats && ratioStats.stdDev !== 0 ? (ratio - ratioStats.meanRatio) / ratioStats.stdDev : null;
    setExportCell(ws, `N${r}`, {
      f: `IF(OR(F${r}="",H${r}="",M${r}=""),"",(F${r}-H${r})/M${r})`,
      value: zScoreValue ?? "",
    });
  });

  // Whole-period summary (Corr/R²/Fair value/Upside %) -- reuses
  // computeRow's own authoritative numbers as the cache, so these can
  // never drift from what the table shows on screen for this AMC.
  const summary = computeRow(entry, maDays, ratioBasis, range, aumOnlyAveraging, levelsCorrelation);
  const basisCol = ratioBasisColumnLetter(ratioBasis);
  const corrFormula = levelsCorrelation ? `IFERROR(CORREL(D:D,E:E),"")` : `IFERROR(CORREL(P:P,Q:Q),"")`;
  setExportCell(ws, "S2", { f: corrFormula, value: summary.corr ?? "" });
  setExportCell(ws, "T2", { f: `IF(S2="","",S2^2)`, value: summary.r2 ?? "" });
  setExportCell(ws, "U2", {
    f: `IF(OR(${basisCol}2="",D${lastRow}=""),"",${basisCol}2*D${lastRow})`,
    value: summary.fairValuePriceInr ?? "",
  });
  setExportCell(ws, "V2", {
    f: `IF(OR(U2="",C${lastRow}=""),"",(U2-C${lastRow})/C${lastRow})`,
    value: summary.upsidePct ?? "",
  });

  ws["!ref"] = `A1:V${lastRow}`;
  return ws;
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
  // Shared with the chart section below (and the walkthrough) -- this is
  // the single source of truth for "what period is currently selected",
  // not just this table's own concern.
  const [range, setRange] = useState<RangeOption>("3y");
  // When on, "Moving avg (days)" only smooths AUM -- share price stays raw,
  // so the ratio (and Corr/R²/Fair value/Z-score derived from it) becomes
  // raw price ÷ avg AUM instead of avg price ÷ avg AUM. See computeRow.
  const [aumOnlyAveraging, setAumOnlyAveraging] = useState(false);
  // When on, Corr/R² correlate the two series' raw LEVELS directly instead
  // of their day-over-day % change -- see computeLevelCorrelationStats.
  const [levelsCorrelation, setLevelsCorrelation] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Applies the saved global default exactly once, the first time it
  // arrives -- a ref (not a state flag) so this can't itself trigger a
  // re-render loop, and so a later SWR revalidation of `data` can't
  // clobber changes the user has since made in this session.
  const defaultsAppliedRef = useRef(false);
  useEffect(() => {
    if (!data?.defaults || defaultsAppliedRef.current) return;
    defaultsAppliedRef.current = true;
    setRange(data.defaults.range);
    setMaDaysInput(data.defaults.maDays > 0 ? String(data.defaults.maDays) : "");
    setRatioBasis(data.defaults.ratioBasis);
    setAumOnlyAveraging(data.defaults.aumOnlyAveraging);
    setLevelsCorrelation(data.defaults.levelsCorrelation);
  }, [data]);

  async function handleSaveDefaults() {
    setIsSaving(true);
    try {
      const res = await fetch("/api/stock-correlation-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          range,
          maDays: maDaysInput === "" ? 0 : maDays,
          ratioBasis,
          aumOnlyAveraging,
          levelsCorrelation,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Save failed");
      }
      toast.success("Saved as the default view for everyone");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setIsSaving(false);
    }
  }

  // One sheet per AMC (full daily AUM/price/derived series for the
  // currently selected period + moving-avg + AUM-only-avg), plus a
  // Settings sheet documenting exactly what was selected when generated --
  // self-contained, so the file makes sense on its own later. Client-side
  // only (xlsx loaded lazily, same as the header's own DownloadExcelButton)
  // since every AMC's full history is already fetched via
  // useAmcStockCorrelations -- no new API route/DB query.
  async function handleDownloadExcel() {
    if (!data) return;
    setIsDownloading(true);
    try {
      const { utils, writeFileXLSX } = await import("xlsx");
      const workbook = utils.book_new();

      const rangeLabel = RANGE_OPTIONS.find((o) => o.value === range)?.label ?? range;
      const settingsRows = [
        { Setting: "Period", Value: rangeLabel },
        { Setting: "Moving avg (days)", Value: maDaysInput === "" ? 0 : maDays },
        { Setting: "AUM-only avg", Value: aumOnlyAveraging ? "On" : "Off" },
        { Setting: "Levels (no % chg) correlation", Value: levelsCorrelation ? "On" : "Off" },
        { Setting: "Ratio basis", Value: activeBasis.label },
        { Setting: "Generated at", Value: new Date().toISOString() },
      ];
      utils.book_append_sheet(workbook, utils.json_to_sheet(settingsRows), "Settings");

      for (const entry of data.amcs) {
        const worksheet = buildAmcWorksheet(entry, maDays, range, aumOnlyAveraging, levelsCorrelation, ratioBasis);
        utils.book_append_sheet(workbook, worksheet, entry.overviewName.slice(0, 31));
      }

      const dateStamp = new Date().toISOString().slice(0, 10);
      writeFileXLSX(workbook, `Stock_Correlation_${rangeLabel}_${dateStamp}.xlsx`);
    } finally {
      setIsDownloading(false);
    }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    return data.amcs.map((entry) => computeRow(entry, maDays, ratioBasis, range, aumOnlyAveraging, levelsCorrelation));
  }, [data, maDays, ratioBasis, range, aumOnlyAveraging, levelsCorrelation]);

  const explainerEntry = useMemo(() => data?.amcs.find((a) => a.slug === EXPLAINER_AMC_SLUG) ?? null, [data]);

  const [chartAmcSlug, setChartAmcSlug] = useState(EXPLAINER_AMC_SLUG);
  const chartEntry = useMemo(() => data?.amcs.find((a) => a.slug === chartAmcSlug) ?? null, [data, chartAmcSlug]);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <details className="max-w-2xl text-sm text-muted-foreground">
          <summary className="cursor-pointer select-none hover:text-foreground">
            Methodology &amp; how these figures are calculated
          </summary>
          <p className="mt-2">
            All 8 AMCs with their own listed share price. Live AUM/Share Price are always today&apos;s raw value.
            Avg AUM/Avg Share Price are the moving average ending today (set by Moving avg (days) below, independent
            of the selected period) — identical to Live AUM/Share Price when Moving avg (days) is 0. The period
            selector scopes Corr/R² and the historical (share price ÷ Live AUM) ratio distribution that Fair value
            and Z-score are measured against; Corr/R² use day-over-day % changes (matches each AMC&apos;s own AUM
            Trend chart). Fair value price = that historical ratio&apos;s mean (or, via Ratio basis, mean ± 1/2
            standard deviations) times Avg AUM — rather than a level-vs-level regression, which would spuriously
            overstate the fit since both series trend upward over time. Upside % always compares Fair value against
            the raw current share price, never the averaged one. Z-score is how many standard deviations today&apos;s
            own (Avg Share Price ÷ Avg AUM) ratio sits from that historical mean, highlighted when |z| ≥ 1 (and more
            strongly at ≥ 2) as notably rich or cheap relative to the AMC&apos;s own history. The
            period/moving-average/ratio-basis selection here is shared with the chart below — changing either
            updates both, and &quot;Save as default&quot; makes the current selection what every visitor sees.
            &quot;AUM-only avg&quot; changes Moving avg (days) to smooth only AUM — share price stays raw, so the
            ratio (and Corr/R²/Fair value/Z-score) becomes each day&apos;s raw share price ÷ that day&apos;s Avg AUM
            instead of Avg Share Price ÷ Avg AUM. &quot;Levels (no % chg)&quot; changes Corr/R² specifically to
            correlate the two series&apos; raw values directly instead of their day-over-day % change — this is
            the level-vs-level regression noted above as spuriously overstating the fit, kept here as an explicit
            opt-in for comparison rather than the default.
          </p>
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1" role="group" aria-label="Date range">
            {RANGE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setRange(o.value)}
                className={
                  o.value === range
                    ? "rounded-md bg-foreground px-2 py-1 text-xs text-background"
                    : "rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                }
              >
                {o.label}
              </button>
            ))}
          </div>
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
          <label
            htmlFor="summary-aum-only-avg"
            title="Moving avg applies only to AUM; the ratio uses each day's raw share price instead of an averaged one"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <input
              id="summary-aum-only-avg"
              type="checkbox"
              checked={aumOnlyAveraging}
              onChange={(e) => setAumOnlyAveraging(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            AUM-only avg
          </label>
          <label
            htmlFor="summary-levels-correlation"
            title="Corr/R² use the two series' raw values directly instead of their day-over-day % change"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <input
              id="summary-levels-correlation"
              type="checkbox"
              checked={levelsCorrelation}
              onChange={(e) => setLevelsCorrelation(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Levels (no % chg)
          </label>
          <button
            type="button"
            onClick={handleSaveDefaults}
            disabled={isSaving}
            title="Save the current period, ratio basis, moving average, and toggle settings as the default every visitor sees"
            className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Save as default"}
          </button>
          <button
            type="button"
            onClick={handleDownloadExcel}
            disabled={isDownloading || !data}
            title="Download all 8 AMCs' full AUM/share price history for the current period and settings, one sheet per AMC"
            className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {isDownloading ? "Preparing…" : "Download Excel"}
          </button>
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
                {aumOnlyAveraging
                  ? `AUM avg (${maDays > 1 ? `${maDays}D` : "Latest"}) · Price raw`
                  : `Avg (${maDays > 1 ? `${maDays}D avg` : "Latest"})`}
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
              <TableHead className="border-l text-right align-bottom">Avg AUM</TableHead>
              <TableHead className="text-right align-bottom">{aumOnlyAveraging ? "Share Price" : "Avg Share Price"}</TableHead>
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
                  {row.avgAumCr !== null ? formatCr(row.avgAumCr) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.avgPriceInr !== null ? formatPriceInr(row.avgPriceInr) : "—"}
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

      <div className="space-y-2 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-foreground">AUM vs. Share Price</p>
          <div className="flex items-center gap-2">
            <label htmlFor="chart-amc-select" className="text-xs text-muted-foreground">
              AMC
            </label>
            <select
              id="chart-amc-select"
              value={chartAmcSlug}
              onChange={(e) => setChartAmcSlug(e.target.value)}
              className={ratioBasisSelectClass}
            >
              {data?.amcs.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.overviewName}
                </option>
              ))}
            </select>
          </div>
        </div>
        {chartEntry && (
          <AumTrendChart
            data={chartEntry.aumHistory}
            stockPriceSeries={chartEntry.stockPriceSeries}
            stockLabel={chartEntry.tradingSymbol}
            range={range}
            onRangeChange={setRange}
            maDaysInput={maDaysInput}
            onMaDaysInputChange={setMaDaysInput}
            aumOnlyAveraging={aumOnlyAveraging}
            levelsCorrelation={levelsCorrelation}
          />
        )}
      </div>

      {explainerEntry && (
        <FairValueExplainer
          entry={explainerEntry}
          maDays={maDays}
          ratioBasis={ratioBasis}
          range={range}
          aumOnlyAveraging={aumOnlyAveraging}
        />
      )}
    </div>
  );
}
