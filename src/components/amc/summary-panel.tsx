"use client";

import { Fragment, useMemo, useState } from "react";
import type { Worksheet, Workbook } from "exceljs";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import type { AmcStockCorrelationEntry } from "@/lib/amc-stock/correlation-summary";
import { computeSummaryViewData, type AumMode, type SummaryViewData } from "@/lib/aum/summary-view";
import { formatPct } from "@/lib/utils/format";
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

// Whole crores, no decimals -- scoped to just this tab (per user request),
// NOT the shared formatCr() used everywhere else in the app (Holdings,
// Overview cards, Compare AMCs, etc. all keep their own 2-decimal display).
function formatCrRounded(valueCr: number): string {
  return `₹${Math.round(valueCr).toLocaleString("en-IN")} cr`;
}

function ValCell({ value, italic = false }: { value: number | null; italic?: boolean }) {
  return (
    <TableCell className={`text-right tabular-nums ${italic ? "italic text-muted-foreground" : ""}`}>
      {value === null ? "—" : formatCrRounded(value)}
    </TableCell>
  );
}

// Cell-fill coloring matching the uploaded Excel template exactly in light
// mode (#C6EFCE/#006100 positive, #FFC7CE/#9C0006 negative); dark mode uses
// an adapted darker/desaturated palette instead of those same pastels
// (which would look blown-out against a dark background) -- confirmed via
// an Artifact preview (light = exact Excel colors, dark = adapted) before
// building. Applies uniformly everywhere PctCell is used (every block,
// including the weekday-seasonality table), since it's the one shared cell
// renderer for every percentage column in this tab.
function PctCell({ value }: { value?: number | null }) {
  if (value === undefined) return <TableCell className="text-right tabular-nums" />;
  if (value === null) {
    return <TableCell className="text-right tabular-nums text-muted-foreground">{"—"}</TableCell>;
  }
  const positive = value >= 0;
  return (
    <TableCell
      className={`text-right tabular-nums font-semibold ${
        positive
          ? "bg-[#C6EFCE] text-[#006100] dark:bg-[#0d3b2b] dark:text-[#6ee7b7]"
          : "bg-[#FFC7CE] text-[#9C0006] dark:bg-[#4c1113] dark:text-[#fca5a5]"
      }`}
    >
      {formatPct(value, { alwaysSign: true })}
    </TableCell>
  );
}

// A banner "section header" row living INSIDE a <TableBody> (not a separate
// <TableHeader>) -- a <table> may only have one real <thead>, and the whole
// point here is for Financial Year/Quarter/Month/Trading-window to share ONE
// <table> (one column-width model) so their Val columns land in the same
// horizontal position, which a separate <table> per block can't guarantee.
function BannerRow({ cols }: { cols: [string, string, string, string] }) {
  return (
    <TableRow className="bg-foreground hover:bg-foreground">
      {cols.map((c, i) => (
        <TableCell key={i} className={`font-semibold text-background ${i === 0 ? "" : "text-right"}`}>
          {c}
        </TableCell>
      ))}
    </TableRow>
  );
}

const CR_FORMAT = '"₹"#,##0" cr"'; // whole crores, no decimals -- matches the web UI's own rounding
const PCT_FORMAT = "0.00%";

// Exact colors from the user's own uploaded reference template.
const POS_FILL = "FFC6EFCE";
const POS_FONT = "FF006100";
const NEG_FILL = "FFFFC7CE";
const NEG_FONT = "FF9C0006";
const BANNER_FILL = "FF000000";
const BANNER_FONT = "FFFFFFFF";

function formatRangeForExport(range?: [string | null, string | null]): string | null {
  if (!range || !range[0] || !range[1]) return null;
  return range[0] === range[1] ? formatRangeDate(range[0]) : `${formatRangeDate(range[0])} - ${formatRangeDate(range[1])}`;
}

function setLabelCell(ws: Worksheet, addr: string, value: string | null | undefined): void {
  if (value === null || value === undefined) return;
  ws.getCell(addr).value = value;
}

function setValCell(ws: Worksheet, addr: string, value: number | null): void {
  if (value === null) return;
  const cell = ws.getCell(addr);
  cell.value = value;
  cell.numFmt = CR_FORMAT;
}

// Fill + font color baked in from the value's already-known sign -- a
// static snapshot (matching the "static values, not live formulas"
// decision), not a live Excel conditional-formatting rule.
function setPctCell(ws: Worksheet, addr: string, value: number | null | undefined): void {
  if (value === null || value === undefined) return;
  const cell = ws.getCell(addr);
  cell.value = value;
  cell.numFmt = PCT_FORMAT;
  const positive = value >= 0;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: positive ? POS_FILL : NEG_FILL } };
  cell.font = { color: { argb: positive ? POS_FONT : NEG_FONT } };
}

function setBannerCell(ws: Worksheet, addr: string, value: string): void {
  const cell = ws.getCell(addr);
  cell.value = value;
  cell.font = { bold: true, color: { argb: BANNER_FONT } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BANNER_FILL } };
}

// One AMC's full Summary view (currently-selected AUM mode only), written
// directly into a new worksheet on the given ExcelJS workbook. Static
// values, no live formulas -- fiscal-quarter/weekday-occurrence math
// doesn't translate cleanly to spreadsheet formulas, and the original
// reference template itself has none either. Uses ExcelJS (not this app's
// usual `xlsx`/SheetJS, see Stock Correlation's own export) specifically
// because SheetJS's free build silently drops cell fill/font styling --
// confirmed by inspecting its own raw OOXML output -- while ExcelJS writes
// real colors for free. Layout mirrors the on-screen blocks exactly: left
// stack (Financial Year / Quarter / Month / Trading-window, A-E) and the
// weekday-seasonality block to the right (G-J) -- one extra "Period" column
// vs. the live UI's own date-range subtext, since Excel has no sub-cell text.
function buildSummaryWorksheet(workbook: Workbook, entry: AmcStockCorrelationEntry, mode: AumMode): void {
  const ws = workbook.addWorksheet(entry.overviewName.slice(0, 31));
  ws.columns = [
    { width: 26 }, { width: 22 }, { width: 16 }, { width: 11 }, { width: 11 },
    { width: 2 }, { width: 26 }, { width: 16 }, { width: 11 }, { width: 11 },
  ];
  const data = computeSummaryViewData(entry.aumHistory, mode, getIstDateString());

  let row = 1;
  const writeLeftBlock = (
    headerCols: [string, string, string, string],
    rows: {
      label: string;
      range?: [string | null, string | null];
      valCr: number | null;
      change1?: number | null;
      change2?: number | null;
    }[]
  ) => {
    setBannerCell(ws, `A${row}`, headerCols[0]);
    setBannerCell(ws, `B${row}`, "Period");
    setBannerCell(ws, `C${row}`, headerCols[1]);
    setBannerCell(ws, `D${row}`, headerCols[2]);
    setBannerCell(ws, `E${row}`, headerCols[3]);
    row++;
    for (const r of rows) {
      setLabelCell(ws, `A${row}`, r.label);
      setLabelCell(ws, `B${row}`, formatRangeForExport(r.range));
      setValCell(ws, `C${row}`, r.valCr);
      setPctCell(ws, `D${row}`, r.change1 ?? null);
      setPctCell(ws, `E${row}`, r.change2 ?? null);
      row++;
    }
    row++; // blank spacer row between blocks
  };

  writeLeftBlock(
    ["Financial Year", "Total", "", "YoY"],
    data.financialYear.map((r) => ({ label: r.label, range: r.range, valCr: r.valCr, change2: r.yoyPct }))
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
  setBannerCell(ws, `G${wRow}`, "Week>>");
  setBannerCell(ws, `H${wRow}`, "Val (In Cr)");
  setBannerCell(ws, `I${wRow}`, "Do 3D");
  setBannerCell(ws, `J${wRow}`, "Do 10D");
  wRow++;
  for (const section of data.weekdays) {
    setLabelCell(ws, `G${wRow}`, section.weekday);
    setValCell(ws, `H${wRow}`, section.top.valCr);
    setPctCell(ws, `I${wRow}`, section.top.do3dPct);
    setPctCell(ws, `J${wRow}`, section.top.do10dPct);
    wRow++;
    setLabelCell(ws, `G${wRow}`, `Average of Last 3 ${section.weekday}s`);
    setValCell(ws, `H${wRow}`, section.avg3Cr);
    wRow++;
    setLabelCell(ws, `G${wRow}`, `Average of Last 10 ${section.weekday}s`);
    setValCell(ws, `H${wRow}`, section.avg10Cr);
    wRow++;
  }
}

// ExcelJS has no browser writeFile helper (unlike SheetJS's writeFileXLSX)
// -- write to an in-memory buffer, wrap it in a Blob, and trigger the save
// via a throwaway <a download> link, same technique used anywhere else a
// client-side blob needs to become a user-facing file download.
function saveWorkbookBuffer(buffer: ArrayBuffer | Uint8Array, filename: string): void {
  const blob = new Blob([buffer as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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
  // only, exceljs loaded lazily -- every AMC's aumHistory is already in
  // `amcs`, no new fetch.
  async function handleDownloadExcel() {
    if (amcs.length === 0) return;
    setIsDownloading(true);
    try {
      const { Workbook } = await import("exceljs");
      const workbook = new Workbook();

      const modeLabel = mode === "average" ? "Average AUM" : "Exit AUM";
      const settingsSheet = workbook.addWorksheet("Settings");
      settingsSheet.columns = [{ header: "Setting", width: 24 }, { header: "Value", width: 32 }];
      settingsSheet.getRow(1).font = { bold: true };
      settingsSheet.addRow(["AUM basis", modeLabel]);
      settingsSheet.addRow(["Generated at", new Date().toISOString()]);

      for (const a of amcs) {
        buildSummaryWorksheet(workbook, a, mode);
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const dateStamp = new Date().toISOString().slice(0, 10);
      saveWorkbookBuffer(buffer, `Summary_${mode === "average" ? "AverageAUM" : "ExitAUM"}_${dateStamp}.xlsx`);
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
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableBody>
                <BannerRow cols={["Financial Year", "Total", "", "YoY"]} />
                {data.financialYear.map((r) => (
                  <TableRow key={r.label}>
                    <TableCell className="font-medium">
                      {r.label}
                      <RangeSub range={r.range} />
                    </TableCell>
                    <ValCell value={r.valCr} />
                    <TableCell />
                    <PctCell value={r.yoyPct} />
                  </TableRow>
                ))}
              </TableBody>

              <TableBody>
                <BannerRow cols={["Quarter>>", "Val (In Cr)", "QoQ", "YoY"]} />
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

              <TableBody>
                <BannerRow cols={["Month>>", "Val (In Cr)", "MoM", "Mo 6M"]} />
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

              <TableBody>
                <BannerRow cols={["Week>>", "Val (In Cr)", "WoW", "Wo 10W"]} />
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

          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableBody>
                <BannerRow cols={["Week>>", "Val (In Cr)", "Do 3D", "Do 10D"]} />
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
