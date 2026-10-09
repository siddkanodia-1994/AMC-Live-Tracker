"use client";

import { Fragment, useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AmcStockCorrelationEntry } from "@/lib/amc-stock/correlation-summary";
import { computeSummaryViewData, type AumMode, type SummaryViewData } from "@/lib/aum/summary-view";
import { formatCr, formatPct } from "@/lib/utils/format";
import { getIstDateString } from "@/lib/utils/date";

const amcSelectClass =
  "w-56 rounded-md border bg-background px-2 py-1 text-xs hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

const segmentActive = "rounded-md bg-foreground px-2 py-1 text-xs text-background";
const segmentInactive = "rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground";

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatRangeDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

function RangeSub({ range }: { range?: [string | null, string | null] }) {
  if (!range || !range[0] || !range[1]) return null;
  const text =
    range[0] === range[1] ? formatRangeDate(range[0]) : `${formatRangeDate(range[0])} – ${formatRangeDate(range[1])}`;
  return <div className="text-[10.5px] font-normal text-muted-foreground/70">{text}</div>;
}

function ValCell({ value, italic = false }: { value: number | null; italic?: boolean }) {
  return (
    <TableCell className={`text-right tabular-nums ${italic ? "italic text-muted-foreground" : ""}`}>
      {value === null ? "—" : formatCr(value)}
    </TableCell>
  );
}

function PctCell({ value }: { value?: number | null }) {
  if (value === undefined) return <TableCell className="text-right tabular-nums" />;
  if (value === null) {
    return <TableCell className="text-right tabular-nums text-muted-foreground">{"—"}</TableCell>;
  }
  return (
    <TableCell className="text-right tabular-nums">
      <span className={value >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
        {formatPct(value, { alwaysSign: true })}
      </span>
    </TableCell>
  );
}

function BannerHeader({ cols }: { cols: string[] }) {
  return (
    <TableHeader>
      <TableRow className="bg-foreground hover:bg-foreground">
        {cols.map((c, i) => (
          <TableHead key={c} className={`text-background ${i === 0 ? "" : "text-right"}`}>
            {c}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

export function SummaryPanel({ amcs }: { amcs: AmcStockCorrelationEntry[] }) {
  const [amcSlug, setAmcSlug] = useState("hdfc-mutual-fund");
  const [mode, setMode] = useState<AumMode>("average");

  const entry = useMemo(() => amcs.find((a) => a.slug === amcSlug) ?? null, [amcs, amcSlug]);

  const data: SummaryViewData | null = useMemo(() => {
    if (!entry) return null;
    return computeSummaryViewData(entry.aumHistory, mode, getIstDateString());
  }, [entry, mode]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-3">
        <div className="flex items-center gap-2">
          <label htmlFor="amc-summary-amc-select" className="text-xs text-muted-foreground">
            AMC
          </label>
          <select
            id="amc-summary-amc-select"
            value={amcSlug}
            onChange={(e) => setAmcSlug(e.target.value)}
            className={amcSelectClass}
          >
            {amcs.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.overviewName}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="AUM basis">
          {(["average", "exit"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={m === mode ? segmentActive : segmentInactive}
            >
              {m === "average" ? "Average AUM" : "Exit AUM"}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {mode === "average"
            ? "Mean of daily Live AUM across each period."
            : "Live AUM as of the last day in each period (closing value)."}
        </span>
      </div>

      {!entry || !data ? (
        <p className="text-sm text-muted-foreground">No AUM history available for this AMC.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-lg border bg-card">
              <Table>
                <BannerHeader cols={["Financial Year", "Total", "YoY"]} />
                <TableBody>
                  {data.financialYear.map((r) => (
                    <TableRow key={r.label}>
                      <TableCell className="font-medium">
                        {r.label}
                        <RangeSub range={r.range} />
                      </TableCell>
                      <ValCell value={r.valCr} />
                      <PctCell value={r.yoyPct} />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="overflow-hidden rounded-lg border bg-card">
              <Table>
                <BannerHeader cols={["Quarter>>", "Val (In Cr)", "QoQ", "YoY"]} />
                <TableBody>
                  {data.quarter.map((r) => (
                    <TableRow key={r.label}>
                      <TableCell className="font-medium">
                        {r.label}
                        <RangeSub range={r.range} />
                      </TableCell>
                      <ValCell value={r.valCr} />
                      <PctCell value={r.qoqPct} />
                      <PctCell value={r.yoyPct} />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="overflow-hidden rounded-lg border bg-card">
              <Table>
                <BannerHeader cols={["Month>>", "Val (In Cr)", "MoM", "Mo 6M"]} />
                <TableBody>
                  {data.month.map((r, i) => {
                    const isSummary = i === data.month.length - 1;
                    return (
                      <TableRow key={r.label} className={isSummary ? "bg-muted/40" : undefined}>
                        <TableCell className={`font-medium ${isSummary ? "pl-6 font-normal italic text-muted-foreground" : ""}`}>
                          {r.label}
                          <RangeSub range={r.range} />
                        </TableCell>
                        <ValCell value={r.valCr} italic={isSummary} />
                        <PctCell value={r.momPct} />
                        <PctCell value={r.mo6mPct} />
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="overflow-hidden rounded-lg border bg-card">
              <Table>
                <BannerHeader cols={["Week>>", "Val (In Cr)", "WoW", "Wo 10W"]} />
                <TableBody>
                  {data.tradingWindow.map((r) => (
                    <TableRow key={r.label}>
                      <TableCell className="font-medium">
                        {r.label}
                        <RangeSub range={r.range} />
                      </TableCell>
                      <ValCell value={r.valCr} />
                      <PctCell value={r.wowPct} />
                      <PctCell value={r.wo10wPct} />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <BannerHeader cols={["Week>>", "Val (In Cr)", "Do 3D", "Do 10D"]} />
              <TableBody>
                {data.weekdays.map((section) => (
                  <Fragment key={section.weekday}>
                    <TableRow className="bg-muted/40 font-semibold">
                      <TableCell className="font-semibold">{section.weekday}</TableCell>
                      <ValCell value={section.top.valCr} />
                      <PctCell value={section.top.do3dPct} />
                      <PctCell value={section.top.do10dPct} />
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-6 text-muted-foreground">Average of Last 3 {section.weekday}s</TableCell>
                      <ValCell value={section.avg3Cr} />
                      <TableCell />
                      <TableCell />
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-6 text-muted-foreground">Average of Last 10 {section.weekday}s</TableCell>
                      <ValCell value={section.avg10Cr} />
                      <TableCell />
                      <TableCell />
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
