"use client";

import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { WindowFieldBox } from "@/components/amc/field-box";
import { formatCr, formatPct, formatPriceInr, formatReportPeriodLabel } from "@/lib/utils/format";
import { useEtfLiveAum } from "@/hooks/use-etf-live-aum";
import { useEtfWindowComparison } from "@/hooks/use-etf-window-comparison";
import { useMcxReference } from "@/hooks/use-mcx-reference";
import { listFiscalQuarters, getFiscalQuarterBounds, getPreviousFiscalQuarterBounds } from "@/lib/aum/report-period";
import { getIstDateString } from "@/lib/utils/date";
import type { EtfLiveAum } from "@/lib/etf/compute-live-aum";
import type { EtfWindowComparisonRow } from "@/lib/etf/window-comparison";

const CUSTOM_VALUE = "custom";
const GROUP_DIVIDER_CLASS = "border-r border-blue-900/20 dark:border-blue-300/20";

function clippedEnd(end: string, maxDate: string | null): string {
  return maxDate && end > maxDate ? maxDate : end;
}

interface SchemeRow {
  amc: string;
  gold: (EtfLiveAum & EtfWindowComparisonRow) | null;
  silver: (EtfLiveAum & EtfWindowComparisonRow) | null;
}

interface RowData {
  amc: string;
  g1: number | null;
  g2: number | null;
  gPrice: number | null;
  gTotal: number | null;
  s1: number | null;
  s2: number | null;
  sPrice: number | null;
  sTotal: number | null;
  t1: number | null;
  t2: number | null;
  tPrice: number | null;
  tTotal: number | null;
}

type SortKey = keyof Omit<RowData, "amc"> | "amc";

const COLUMN_LABELS: Record<Exclude<SortKey, "amc" | "g1" | "g2" | "s1" | "s2" | "t1" | "t2">, string> = {
  gPrice: "Price QoQ",
  gTotal: "Total QoQ",
  sPrice: "Price QoQ",
  sTotal: "Total QoQ",
  tPrice: "Price QoQ",
  tTotal: "Total QoQ",
};

function AumCell({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  return <TableCell className={`text-right tabular-nums ${className}`}>{value != null ? formatCr(value) : "—"}</TableCell>;
}

function PctCell({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <TableCell className={`text-right tabular-nums ${className}`}>—</TableCell>;
  return (
    <TableCell className={`text-right tabular-nums ${className}`}>
      <span className={value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
        {formatPct(value, { alwaysSign: true })}
      </span>
    </TableCell>
  );
}

function GroupHeadingCell({ label, colorClass }: { label: string; colorClass: string }) {
  return <TableHead colSpan={4} className={`text-center text-xs font-bold tracking-wide uppercase ${colorClass}`}>{label}</TableHead>;
}

function dashCell(className = "") {
  return (
    <TableCell className={`text-right tabular-nums text-muted-foreground ${className}`}>—</TableCell>
  );
}

export function EtfOverviewStyleTable() {
  const { data: liveData } = useEtfLiveAum();
  const { data: mcxData } = useMcxReference();

  const today = getIstDateString();
  const defaultCurrent = getFiscalQuarterBounds(today);
  const defaultPrior = getPreviousFiscalQuarterBounds(today);

  const [w1Start, setW1Start] = useState<string>(defaultPrior.start);
  const [w1End, setW1End] = useState<string>(defaultPrior.end);
  const [w2Start, setW2Start] = useState<string>(defaultCurrent.start);
  const [w2End, setW2End] = useState<string>(today);
  const [w1Expanded, setW1Expanded] = useState(false);
  const [w2Expanded, setW2Expanded] = useState(false);
  const [showExit, setShowExit] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("t2");
  const [sortDesc, setSortDesc] = useState(true);

  const { data: comparisonData, isLoading, error } = useEtfWindowComparison(w1Start, w1End, w2Start, w2End);
  const bounds = comparisonData?.dataBounds;

  // The dropdown's latest selectable quarter is always "today", not the
  // latest REAL anchor (bounds.maxDate) -- an in-progress quarter (e.g.
  // Q3FY27) has no real anchor yet by definition, but the backend already
  // computes it correctly via a live NAV-only extrapolation. Capping the
  // list at bounds.maxDate instead would silently drop the current quarter
  // from both dropdowns, leaving Window 2 unable to go any later than
  // Window 1's own default. bounds.minDate is still the right floor --
  // there's genuinely no data before the first real anchor.
  const quarterOptions = useMemo(() => {
    if (!bounds?.minDate) return [];
    return listFiscalQuarters(bounds.minDate, today);
  }, [bounds, today]);

  const w1QuarterKey = useMemo(() => {
    const match = quarterOptions.find((q) => q.start === w1Start && clippedEnd(q.end, today) === w1End);
    return match?.key ?? CUSTOM_VALUE;
  }, [quarterOptions, w1Start, w1End, today]);
  const w2QuarterKey = useMemo(() => {
    const match = quarterOptions.find((q) => q.start === w2Start && clippedEnd(q.end, today) === w2End);
    return match?.key ?? CUSTOM_VALUE;
  }, [quarterOptions, w2Start, w2End, today]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  const schemeById = useMemo(() => {
    const map = new Map<number, EtfLiveAum>();
    for (const s of liveData?.schemes ?? []) map.set(s.schemeId, s);
    return map;
  }, [liveData]);

  const rows = useMemo<RowData[]>(() => {
    if (!comparisonData) return [];
    const byAmc = new Map<string, SchemeRow>();
    for (const r of comparisonData.rows) {
      const meta = schemeById.get(r.schemeId);
      if (!meta) continue;
      const entry = byAmc.get(meta.amc) ?? { amc: meta.amc, gold: null, silver: null };
      const merged = { ...meta, ...r };
      if (meta.assetClass === "gold") entry.gold = merged;
      else entry.silver = merged;
      byAmc.set(meta.amc, entry);
    }
    return Array.from(byAmc.values()).map((r) => {
      const g = r.gold;
      const s = r.silver;
      const g1 = g ? (showExit ? g.window1.exitAumCr : g.window1.avgAumCr) : null;
      const g2 = g ? (showExit ? g.window2.exitAumCr : g.window2.avgAumCr) : null;
      const s1 = s ? (showExit ? s.window1.exitAumCr : s.window1.avgAumCr) : null;
      const s2 = s ? (showExit ? s.window2.exitAumCr : s.window2.avgAumCr) : null;
      const gTotal = g1 != null && g2 != null && g1 !== 0 ? (g2 - g1) / g1 : null;
      const sTotal = s1 != null && s2 != null && s1 !== 0 ? (s2 - s1) / s1 : null;
      const gPrice = g?.priceOnlyPct ?? null;
      const sPrice = s?.priceOnlyPct ?? null;
      const t1 = g1 != null || s1 != null ? (g1 ?? 0) + (s1 ?? 0) : null;
      const t2 = g2 != null || s2 != null ? (g2 ?? 0) + (s2 ?? 0) : null;
      const tTotal = t1 != null && t1 !== 0 && t2 != null ? (t2 - t1) / t1 : null;
      const priceWeightSum = (gPrice != null && g1 ? g1 : 0) + (sPrice != null && s1 ? s1 : 0);
      const tPrice = priceWeightSum > 0 ? ((gPrice != null && g1 ? g1 * gPrice : 0) + (sPrice != null && s1 ? s1 * sPrice : 0)) / priceWeightSum : null;
      return { amc: r.amc, g1, g2, gPrice, gTotal, s1, s2, sPrice, sTotal, t1, t2, tPrice, tTotal };
    });
  }, [comparisonData, schemeById, showExit]);

  const sorted = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const av = a[sortKey as keyof RowData];
      const bv = b[sortKey as keyof RowData];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDesc ? -cmp : cmp;
    });
    return list;
  }, [rows, sortKey, sortDesc]);

  function sum(list: (number | null)[]): number | null {
    const vals = list.filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  }
  function weightedAvg(pairs: [number | null, number | null][]): number | null {
    let num = 0;
    let den = 0;
    for (const [w, v] of pairs) {
      if (w != null && v != null) {
        num += w * v;
        den += w;
      }
    }
    return den > 0 ? num / den : null;
  }

  const tg1 = sum(rows.map((r) => r.g1));
  const tg2 = sum(rows.map((r) => r.g2));
  const ts1 = sum(rows.map((r) => r.s1));
  const ts2 = sum(rows.map((r) => r.s2));
  const tt1 = sum(rows.map((r) => r.t1));
  const tt2 = sum(rows.map((r) => r.t2));
  const tgTotal = tg1 != null && tg1 !== 0 && tg2 != null ? (tg2 - tg1) / tg1 : null;
  const tsTotal = ts1 != null && ts1 !== 0 && ts2 != null ? (ts2 - ts1) / ts1 : null;
  const ttTotal = tt1 != null && tt1 !== 0 && tt2 != null ? (tt2 - tt1) / tt1 : null;
  const tgPrice = weightedAvg(rows.map((r) => [r.g1, r.gPrice]));
  const tsPrice = weightedAvg(rows.map((r) => [r.s1, r.sPrice]));
  const ttPrice = weightedAvg(rows.map((r) => [r.t1, r.tPrice]));

  function SortHead({ label, sk, className = "" }: { label: string; sk: SortKey; className?: string }) {
    const active = sk === sortKey;
    return (
      <TableHead className={`text-right align-bottom ${className}`}>
        <button type="button" onClick={() => toggleSort(sk)} className="hover:text-foreground">
          {label}
          {active ? (sortDesc ? " ↓" : " ↑") : ""}
        </button>
      </TableHead>
    );
  }

  if (error) return <p className="text-sm text-destructive">Failed to load ETF comparison: {error.message}</p>;
  if (isLoading && !comparisonData) return <Skeleton className="h-96 w-full rounded-xl" />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <WindowFieldBox label="Window 1 (prior)" expanded={w1Expanded || w1QuarterKey === CUSTOM_VALUE} onToggleExpanded={() => setW1Expanded((e) => !e)}>
          {!(w1Expanded || w1QuarterKey === CUSTOM_VALUE) ? (
            <select
              className="rounded-md border bg-background px-2 py-1 text-sm"
              value={w1QuarterKey}
              onChange={(e) => {
                const q = quarterOptions.find((o) => o.key === e.target.value);
                if (q) {
                  setW1Start(q.start);
                  setW1End(clippedEnd(q.end, today));
                }
              }}
            >
              {quarterOptions.map((q) => (
                <option key={q.key} value={q.key}>
                  {q.label}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex gap-2">
              <input type="date" className="rounded-md border bg-background px-2 py-1 text-xs" value={w1Start} onChange={(e) => setW1Start(e.target.value)} />
              <input type="date" className="rounded-md border bg-background px-2 py-1 text-xs" value={w1End} onChange={(e) => setW1End(e.target.value)} />
            </div>
          )}
        </WindowFieldBox>
        <WindowFieldBox label="Window 2 (current)" expanded={w2Expanded || w2QuarterKey === CUSTOM_VALUE} onToggleExpanded={() => setW2Expanded((e) => !e)}>
          {!(w2Expanded || w2QuarterKey === CUSTOM_VALUE) ? (
            <select
              className="rounded-md border bg-background px-2 py-1 text-sm"
              value={w2QuarterKey}
              onChange={(e) => {
                const q = quarterOptions.find((o) => o.key === e.target.value);
                if (q) {
                  setW2Start(q.start);
                  setW2End(clippedEnd(q.end, today));
                }
              }}
            >
              {quarterOptions.map((q) => (
                <option key={q.key} value={q.key}>
                  {q.label}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex gap-2">
              <input type="date" className="rounded-md border bg-background px-2 py-1 text-xs" value={w2Start} onChange={(e) => setW2Start(e.target.value)} />
              <input type="date" className="rounded-md border bg-background px-2 py-1 text-xs" value={w2End} onChange={(e) => setW2End(e.target.value)} />
            </div>
          )}
        </WindowFieldBox>
        <label className="flex min-w-[190px] flex-1 items-center gap-2 rounded-lg border bg-[var(--toolbar-accent-soft)]/40 px-3 py-2">
          <input type="checkbox" checked={showExit} onChange={(e) => setShowExit(e.target.checked)} />
          <span className="text-sm">
            Showing: <b>{showExit ? "Exit AUM" : "Average AUM"}</b>
          </span>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead />
              <GroupHeadingCell label="Gold ETF" colorClass="text-amber-800 dark:text-amber-400" />
              <GroupHeadingCell label="Silver ETF" colorClass="text-slate-600 dark:text-slate-300" />
              <GroupHeadingCell label="Total (Gold + Silver)" colorClass="text-[var(--toolbar-accent)]" />
            </TableRow>
            <TableRow>
              <TableHead className="align-bottom">
                <button type="button" onClick={() => toggleSort("amc")} className="hover:text-foreground">
                  AMC{sortKey === "amc" ? (sortDesc ? " ↓" : " ↑") : ""}
                </button>
              </TableHead>
              <SortHead label={COLUMN_LABELS.gPrice} sk="gPrice" />
              <SortHead label={quarterOptions.find((q) => q.key === w1QuarterKey)?.label ?? "Window 1"} sk="g1" />
              <SortHead label={quarterOptions.find((q) => q.key === w2QuarterKey)?.label ?? "Window 2"} sk="g2" />
              <SortHead label={COLUMN_LABELS.gTotal} sk="gTotal" className={GROUP_DIVIDER_CLASS} />
              <SortHead label={COLUMN_LABELS.sPrice} sk="sPrice" />
              <SortHead label={quarterOptions.find((q) => q.key === w1QuarterKey)?.label ?? "Window 1"} sk="s1" />
              <SortHead label={quarterOptions.find((q) => q.key === w2QuarterKey)?.label ?? "Window 2"} sk="s2" />
              <SortHead label={COLUMN_LABELS.sTotal} sk="sTotal" className={GROUP_DIVIDER_CLASS} />
              <SortHead label={COLUMN_LABELS.tPrice} sk="tPrice" />
              <SortHead label={quarterOptions.find((q) => q.key === w1QuarterKey)?.label ?? "Window 1"} sk="t1" />
              <SortHead label={quarterOptions.find((q) => q.key === w2QuarterKey)?.label ?? "Window 2"} sk="t2" />
              <SortHead label={COLUMN_LABELS.tTotal} sk="tTotal" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.amc}>
                <TableCell className="font-medium">{r.amc}</TableCell>
                <PctCell value={r.gPrice} />
                <AumCell value={r.g1} />
                <AumCell value={r.g2} />
                <PctCell value={r.gTotal} className={GROUP_DIVIDER_CLASS} />
                <PctCell value={r.sPrice} />
                <AumCell value={r.s1} />
                <AumCell value={r.s2} />
                <PctCell value={r.sTotal} className={GROUP_DIVIDER_CLASS} />
                <PctCell value={r.tPrice} />
                <AumCell value={r.t1} className="font-medium" />
                <AumCell value={r.t2} className="font-medium" />
                <PctCell value={r.tTotal} />
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">Total ({rows.filter((r) => r.g1 != null || r.g2 != null).length} Gold / {rows.filter((r) => r.s1 != null || r.s2 != null).length} Silver AMCs)</TableCell>
              <PctCell value={tgPrice} />
              <AumCell value={tg1} className="font-medium" />
              <AumCell value={tg2} className="font-medium" />
              <PctCell value={tgTotal} className={GROUP_DIVIDER_CLASS} />
              <PctCell value={tsPrice} />
              <AumCell value={ts1} className="font-medium" />
              <AumCell value={ts2} className="font-medium" />
              <PctCell value={tsTotal} className={GROUP_DIVIDER_CLASS} />
              <PctCell value={ttPrice} />
              <AumCell value={tt1} className="font-medium" />
              <AumCell value={tt2} className="font-medium" />
              <PctCell value={ttTotal} />
            </TableRow>
            {mcxData?.rows.map((row) => (
              <TableRow key={row.metal} className="bg-muted/30">
                <TableCell className="font-medium" title="Front-month MCX futures contract — no true spot market exists for gold/silver.">
                  {row.displayName}
                  {row.contractExpiryDate && (
                    <span className="font-normal text-muted-foreground"> ({formatReportPeriodLabel(row.contractExpiryDate.slice(0, 7))})</span>
                  )}
                </TableCell>
                {row.metal === "gold" ? (
                  <>
                    <PctCell value={row.deltaPct} />
                    <TableCell className="text-right tabular-nums">{row.quarterEndPriceInr != null ? `${formatPriceInr(row.quarterEndPriceInr)}/${row.unit}` : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.livePriceInr != null ? `${formatPriceInr(row.livePriceInr)}/${row.unit}` : "—"}</TableCell>
                    {dashCell(GROUP_DIVIDER_CLASS)}
                    {dashCell()}
                    {dashCell()}
                    {dashCell()}
                    {dashCell(GROUP_DIVIDER_CLASS)}
                  </>
                ) : (
                  <>
                    {dashCell()}
                    {dashCell()}
                    {dashCell()}
                    {dashCell(GROUP_DIVIDER_CLASS)}
                    <PctCell value={row.deltaPct} />
                    <TableCell className="text-right tabular-nums">{row.quarterEndPriceInr != null ? `${formatPriceInr(row.quarterEndPriceInr)}/${row.unit}` : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.livePriceInr != null ? `${formatPriceInr(row.livePriceInr)}/${row.unit}` : "—"}</TableCell>
                    {dashCell(GROUP_DIVIDER_CLASS)}
                  </>
                )}
                {dashCell()}
                {dashCell()}
                {dashCell()}
                {dashCell()}
              </TableRow>
            ))}
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
