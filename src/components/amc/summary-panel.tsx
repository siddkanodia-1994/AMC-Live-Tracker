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

const CR_FORMAT = '"₹"#,##0.00" cr"';
const PCT_FORMAT = "0.00%";

function setCell(ws: Record<string, unknown>, addr: string, value: string | number | null | undefined, fmt?: string): void {
  if (value === null || value === undefined) return;
  ws[addr] = typeof value === "number" ? { t: "n", v: value, ...(fmt ? { z: fmt } : {}) } : { t: "s", v: value };
}

function formatRangeForExport(range?: [string | null, string | null]): string | null {
  if (!range || !range[0] || !range[1]) return null;
  return range[0] === range[1] ? formatRangeDate(range[0]) : `${formatRangeDate(range[0])} - ${formatRangeDate(range[1])}`;
}

// One AMC's full Summary view (currently-selected AUM mode only) as a
// static-value worksheet -- no live formulas (fiscal-quarter/weekday-
// occurrence math doesn't translate cleanly to spreadsheet formulas, and
// the original reference template itself has none either) and no cell
// fill/font styling (this app's existing xlsx export, buildAmcWorksheet in
// stock-correlation-table.tsx, doesn't apply any either -- the underlying
// SheetJS community build used here only writes per-cell number formats
// via `z`, not fill/bold styling). Layout mirrors the on-screen blocks
// exactly: left stack (Financial Year / Quarter / Month / Trading-window,
// each with its own header row, A-E) and the weekday-seasonality block to
// the right (G-J) -- one extra "Period" column vs. the live UI's own
// date-range subtext, since Excel has no sub-cell text.
function buildSummaryWorksheet(entry: AmcStockCorrelationEntry, mode: AumMode): Record<string, unknown> {
  const ws: Record<string, unknown> = {};
  const data = computeSummaryViewData(entry.aumHistory, mode, getIstDateString());

  let row = 1;
  const writeLeftBlock = (
    headerCols: [string, string, string, string?],
    rows: { label: string; range?: [string | null, string | null]; valCr: number | null; change1?: number | null; change2?: number | null }[]
  ) => {
    setCell(ws, `A${row}`, headerCols[0]);
    setCell(ws, `B${row}`, "Period");
    setCell(ws, `C${row}`, headerCols[1]);
    setCell(ws, `D${row}`, headerCols[2]);
    if (headerCols[3]) setCell(ws, `E${row}`, headerCols[3]);
    row++;
    for (const r of rows) {
      setCell(ws, `A${row}`, r.label);
      setCell(ws, `B${row}`, formatRangeForExport(r.range));
      setCell(ws, `C${row}`, r.valCr, CR_FORMAT);
      setCell(ws, `D${row}`, r.change1 ?? null, PCT_FORMAT);
      if (headerCols[3]) setCell(ws, `E${row}`, r.change2 ?? null, PCT_FORMAT);
      row++;
    }
    row++; // blank spacer row between blocks
  };

  writeLeftBlock(
    ["Financial Year", "Total", "YoY"],
    data.financialYear.map((r) => ({ label: r.label, range: r.range, valCr: r.valCr, change1: r.yoyPct }))
  );
  writeLeftBlock(
    ["Quarter>>", "Val (In Cr)", "QoQ", "YoY"],
    data.quarter.map((r) => ({ label: r.label, range: r.range, valCr: r.valCr, change1: r.qoqPct, change2: r.yoyPct }))
  );
  writeLeftBlock(
    ["Month>>", "Val (In Cr)", "MoM", "Mo 6M"],
    data.month.map((r) => ({ label: r.label, range: r.range, valCr: r.valCr, change1: r.momPct, change2: r.mo6mPct }))
  );
  writeLeftBlock(
    ["Week>>", "Val (In Cr)", "WoW", "Wo 10W"],
    data.tradingWindow.map((r) => ({ label: r.label, range: r.range, valCr: r.valCr, change1: r.wowPct, change2: r.wo10wPct }))
  );

  let wRow = 1;
  setCell(ws, `G${wRow}`, "Week>>");
  setCell(ws, `H${wRow}`, "Val (In Cr)");
  setCell(ws, `I${wRow}`, "Do 3D");
  setCell(ws, `J${wRow}`, "Do 10D");
  wRow++;
  for (const section of data.weekdays) {
    setCell(ws, `G${wRow}`, section.weekday);
    setCell(ws, `H${wRow}`, section.top.valCr, CR_FORMAT);
    setCell(ws, `I${wRow}`, section.top.do3dPct, PCT_FORMAT);
    setCell(ws, `J${wRow}`, section.top.do10dPct, PCT_FORMAT);
    wRow++;
    setCell(ws, `G${wRow}`, `Average of Last 3 ${section.weekday}s`);
    setCell(ws, `H${wRow}`, section.avg3Cr, CR_FORMAT);
    wRow++;
    setCell(ws, `G${wRow}`, `Average of Last 10 ${section.weekday}s`);
    setCell(ws, `H${wRow}`, section.avg10Cr, CR_FORMAT);
    wRow++;
  }

  ws["!ref"] = `A1:J${Math.max(row, wRow)}`;
  ws["!cols"] = [{ wch: 26 }, { wch: 24 }, { wch: 16 }, { wch: 11 }, { wch: 11 }];
  return ws;
}

export function SummaryPanel({ amcs }: { amcs: AmcStockCorrelationEntry[] }) {
  const [amcSlug, setAmcSlug] = useState("hdfc-mutual-fund");
  const [mode, setMode] = useState<AumMode>("average");
  const [isDownloading, setIsDownloading] = useState(false);

  const entry = useMemo(() => amcs.find((a) => a.slug === amcSlug) ?? null, [amcs, amcSlug]);

  const data: SummaryViewData | null = useMemo(() => {
    if (!entry) return null;
    return computeSummaryViewData(entry.aumHistory, mode, getIstDateString());
  }, [entry, mode]);

  // One sheet per AMC (all 8, not just the one currently selected), in the
  // currently-selected AUM basis only -- matches the Stock Correlation
  // tab's own "Download Excel" one-sheet-per-AMC convention. Client-side
  // only, xlsx loaded lazily, same as that button -- every AMC's aumHistory
  // is already in `amcs`, no new fetch.
  async function handleDownloadExcel() {
    if (amcs.length === 0) return;
    setIsDownloading(true);
    try {
      const { utils, writeFileXLSX } = await import("xlsx");
      const workbook = utils.book_new();

      const modeLabel = mode === "average" ? "Average AUM" : "Exit AUM";
      const settingsRows = [
        { Setting: "AUM basis", Value: modeLabel },
        { Setting: "Generated at", Value: new Date().toISOString() },
      ];
      utils.book_append_sheet(workbook, utils.json_to_sheet(settingsRows), "Settings");

      for (const a of amcs) {
        const worksheet = buildSummaryWorksheet(a, mode);
        utils.book_append_sheet(workbook, worksheet, a.overviewName.slice(0, 31));
      }

      const dateStamp = new Date().toISOString().slice(0, 10);
      writeFileXLSX(workbook, `Summary_${mode === "average" ? "AverageAUM" : "ExitAUM"}_${dateStamp}.xlsx`);
    } finally {
      setIsDownloading(false);
    }
  }

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
        <span className="text-xs text-muted-foreground">
          {mode === "average"
            ? "Mean of daily Live AUM across each period."
            : "Live AUM as of the last day in each period (closing value)."}
        </span>
        <button
          type="button"
          onClick={handleDownloadExcel}
          disabled={isDownloading || amcs.length === 0}
          title={`Download all 8 AMCs' Summary view (${mode === "average" ? "Average AUM" : "Exit AUM"}), one sheet per AMC`}
          className="ml-auto rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {isDownloading ? "Preparing…" : "Download Excel"}
        </button>
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
