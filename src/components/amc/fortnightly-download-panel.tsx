"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useFlowEstimateDisplay } from "@/components/layout/flow-estimate-context";
import { useFortnightlyEligibleAmcs } from "@/hooks/use-fortnightly-update";
import { buildFortnightlyExportSections, buildFortnightlySheetExcel, price, pct, sanitizeForPdf } from "@/lib/aum/fortnightly-export";
import { formatShortDate } from "@/lib/utils/format";
import type { FortnightlySheet, VerdictTier } from "@/lib/aum/fortnightly-update";

// ExcelJS has no browser writeFile helper (unlike SheetJS's writeFileXLSX) --
// write to an in-memory buffer, wrap it in a Blob, and trigger the save via
// a throwaway <a download> link. Local copy of summary-panel.tsx's own
// helper of the same name/shape (not shared/exported from there).
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

// Same black banner / green-red percentage colors as the live tab and
// summary-panel.tsx's own Excel export -- applied via autoTable's
// didParseCell since jsPDF-autotable has no per-row "kind" of its own.
const BANNER_RGB: [number, number, number] = [0, 0, 0];
const BANNER_TEXT_RGB: [number, number, number] = [255, 255, 255];
const POS_RGB: [number, number, number] = [198, 239, 206];
const POS_TEXT_RGB: [number, number, number] = [0, 97, 0];
const NEG_RGB: [number, number, number] = [255, 199, 206];
const NEG_TEXT_RGB: [number, number, number] = [156, 0, 6];

// The Overview card's own banner colors (fortnightly-update-panel.tsx's
// Option-B header) -- jsPDF has no gradient fill, so this is a solid navy
// approximation of that banner's start color, not a literal gradient.
const OVERVIEW_BANNER_RGB: [number, number, number] = [15, 23, 42]; // #0f172a
const OVERVIEW_SUBTEXT_RGB: [number, number, number] = [203, 213, 225]; // text-slate-300
const UPSIDE_POS_RGB: [number, number, number] = [134, 239, 172]; // #86efac
const UPSIDE_NEG_RGB: [number, number, number] = [252, 165, 165]; // #fca5a5

// Same 5-tier colors as the live tab's VERDICT_PILL_CLASS (light-mode
// values only -- a PDF has no dark-mode concept).
const VERDICT_PILL_RGB: Record<VerdictTier, { fill: [number, number, number]; text: [number, number, number] }> = {
  buy: { fill: [21, 128, 61], text: [255, 255, 255] },
  accumulate: { fill: [198, 239, 206], text: [0, 97, 0] },
  hold: { fill: [254, 243, 199], text: [146, 64, 14] },
  reduce: { fill: [254, 215, 170], text: [154, 52, 18] },
  sell: { fill: [255, 199, 206], text: [156, 0, 6] },
};
const VERDICT_PDF_LABELS: Record<VerdictTier, string> = {
  buy: "BUY",
  accumulate: "ACCUMULATE",
  hold: "HOLD",
  reduce: "REDUCE",
  sell: "SELL",
};

const addSelectClass =
  "min-w-0 max-w-[240px] rounded-md border border-dashed bg-background px-2 py-1 text-sm text-muted-foreground hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

// Custom-drawn replacement for the old plain-text title + generic
// autoTable "Overview" section -- a solid navy banner (jsPDF has no
// gradient fill) approximating the live dashboard's own Option-B Overview
// card header, absorbing the title line entirely (no separate "AMC Name —
// as of ..." text above it, matching the live card's own layout). `doc`
// is typed loosely (consistent with this function's other jsPDF usage,
// e.g. `(doc as any).lastAutoTable`) since jsPDF's own types are imported
// dynamically inside handleDownloadPdf, not available at module scope.
// Returns the Y position to continue drawing from.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawOverviewBanner(doc: any, sheet: FortnightlySheet, pageWidth: number, startY: number): number {
  const bannerHeight = 26;
  const leftX = 18;
  const rightX = pageWidth - 18;
  const effectiveVerdict = sheet.manual.verdictOverride ?? sheet.autoVerdict;

  doc.setFillColor(...OVERVIEW_BANNER_RGB);
  doc.rect(14, startY, pageWidth - 28, bannerHeight, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text(sheet.overviewName, leftX, startY + 9);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...OVERVIEW_SUBTEXT_RGB);
  doc.text(`As of ${formatShortDate(sheet.asOfDate)} · CMP ${price(sheet.cmpInr)}`, leftX, startY + 15);

  // Verdict pill, top-right.
  const verdictLabel = effectiveVerdict ? VERDICT_PDF_LABELS[effectiveVerdict] : "—";
  const pillColors = effectiveVerdict ? VERDICT_PILL_RGB[effectiveVerdict] : { fill: [255, 255, 255] as [number, number, number], text: OVERVIEW_BANNER_RGB };
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const pillW = doc.getTextWidth(verdictLabel) + 8;
  const pillH = 6.5;
  const pillX = rightX - pillW;
  const pillY = startY + 4;
  doc.setFillColor(...pillColors.fill);
  doc.roundedRect(pillX, pillY, pillW, pillH, 1.5, 1.5, "F");
  doc.setTextColor(...pillColors.text);
  doc.text(verdictLabel, pillX + pillW / 2, pillY + pillH / 2 + 1, { align: "center" });

  // Stat lines, right-aligned, below the pill.
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text(`Target Price (Base): ${price(sheet.valuation.fy28TargetPriceInr.base)} · Target Period: FY28E`, rightX, startY + 15, {
    align: "right",
  });
  const upside = sheet.valuation.fy28UpsidePct.base;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...(upside !== null && upside >= 0 ? UPSIDE_POS_RGB : UPSIDE_NEG_RGB));
  doc.text(`Upside: ${pct(upside)}`, rightX, startY + 21, { align: "right" });

  doc.setTextColor(0, 0, 0);
  let cursorY = startY + bannerHeight + 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Summary", 14, cursorY);
  cursorY += 5;

  // Two-column (bold Label | Detail) rows inside a bordered box using this
  // app's own manual-input blue (#d7ecff fill / #a9d2f2 border) -- the
  // user's chosen formatting, confirmed via preview. Each stored line is
  // "• Label: detail"; a line that doesn't match that shape (an analyst's
  // own free-form note) renders with an empty label, detail only -- no
  // crash, since this field is free text.
  const rawSummary = sheet.manual.summary;
  const lines = rawSummary && rawSummary.length > 0 ? rawSummary.split("\n") : ["No summary written yet."];
  const boxX = 14;
  const boxWidth = pageWidth - 28;
  const labelColWidth = 34;
  const detailColX = boxX + 6 + labelColWidth + 4;
  const detailColWidth = boxX + boxWidth - 6 - detailColX;

  doc.setFontSize(8);
  const rowsData = lines.map((line) => {
    const match = /^•\s*([^:]+):(.*)$/.exec(line);
    const label = match ? sanitizeForPdf(match[1].trim()) : "";
    const detail = sanitizeForPdf((match ? match[2] : line).trim());
    doc.setFont("helvetica", "normal");
    const detailLines: string[] = doc.splitTextToSize(detail, detailColWidth);
    const rowHeight = Math.max(detailLines.length * 3.6, 6) + 3;
    return { label, detailLines, rowHeight };
  });
  const boxHeight = rowsData.reduce((sum, r) => sum + r.rowHeight, 0) + 6;

  doc.setFillColor(215, 236, 255); // #d7ecff
  doc.setDrawColor(169, 210, 242); // #a9d2f2
  doc.roundedRect(boxX, cursorY, boxWidth, boxHeight, 1.5, 1.5, "FD");

  let rowY = cursorY + 7;
  doc.setTextColor(11, 35, 56); // #0b2338
  rowsData.forEach((r, i) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(r.label, boxX + 6, rowY);
    doc.setFont("helvetica", "normal");
    doc.text(r.detailLines, detailColX, rowY);
    if (i < rowsData.length - 1) {
      const sepY = rowY + r.rowHeight - 1.5;
      doc.setLineWidth(0.2);
      doc.line(boxX + 3, sepY, boxX + boxWidth - 3, sepY);
    }
    rowY += r.rowHeight;
  });

  doc.setTextColor(0, 0, 0);
  cursorY += boxHeight + 8;
  return cursorY;
}

// WYSIWYG -- matches whatever the header's "Incl. Est. Flow" toggle shows
// on screen at download time, same convention as the Overview table's own
// export (see amc-table.tsx's useRegisterExport).
async function fetchLatestSheet(amcId: number, includeFlowEstimate: boolean): Promise<FortnightlySheet> {
  const res = await fetch(`/api/fortnightly-update?amcId=${amcId}${includeFlowEstimate ? "&includeFlowEstimate=true" : ""}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to load AMC ${amcId}`);
  }
  return res.json();
}

/**
 * Pick-several-of-8 + combined Excel/PDF download -- same pill add/remove
 * convention as compare-amcs-panel.tsx, no cap (universe is fixed at 8).
 * Both downloads always use each selected AMC's LATEST fortnightly
 * snapshot (not whichever one the main panel above happens to be viewing)
 * -- a combined multi-AMC report comparing different as-of dates per AMC
 * wouldn't mean much. Client-side only, same "no server round-trip" model
 * as every other export in this app -- bypasses the shared header
 * ExportContext (single-sheet-only) exactly as the Stock Correlation tab's
 * and Summary tab's own bespoke download buttons already do.
 */
export function FortnightlyDownloadPanel() {
  const { data: amcsData } = useFortnightlyEligibleAmcs();
  const { includeFlowEstimate } = useFlowEstimateDisplay();
  const [selected, setSelected] = useState<number[]>([]);
  const [downloading, setDownloading] = useState<"excel" | "pdf" | null>(null);

  const availableToAdd = useMemo(
    () => (amcsData?.amcs ?? []).filter((a) => !selected.includes(a.amcId)),
    [amcsData, selected]
  );
  const nameById = useMemo(() => new Map((amcsData?.amcs ?? []).map((a) => [a.amcId, a.overviewName])), [amcsData]);

  function add(amcId: number) {
    if (!amcId || selected.includes(amcId)) return;
    setSelected((prev) => [...prev, amcId]);
  }
  function remove(amcId: number) {
    setSelected((prev) => prev.filter((id) => id !== amcId));
  }

  async function handleDownloadExcel() {
    if (selected.length === 0) return;
    setDownloading("excel");
    try {
      const { Workbook } = await import("exceljs");
      const workbook = new Workbook();
      for (const amcId of selected) {
        const sheet = await fetchLatestSheet(amcId, includeFlowEstimate);
        buildFortnightlySheetExcel(workbook, sheet);
      }
      const dateStamp = new Date().toISOString().slice(0, 10);
      const buffer = await workbook.xlsx.writeBuffer();
      saveWorkbookBuffer(buffer, `Fortnightly_AMC_Update_${dateStamp}.xlsx`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to build Excel file");
    } finally {
      setDownloading(null);
    }
  }

  async function handleDownloadPdf() {
    if (selected.length === 0) return;
    setDownloading("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      for (let i = 0; i < selected.length; i++) {
        if (i > 0) doc.addPage();
        const sheet = await fetchLatestSheet(selected[i], includeFlowEstimate);
        const sections = buildFortnightlyExportSections(sheet);
        let cursorY = drawOverviewBanner(doc, sheet, pageWidth, 14);
        for (const section of sections.slice(1)) {
          // Section banner bar -- same black-fill/white-text as the
          // dashboard's own SectionBanner and the Excel export's writeBanner.
          doc.setFillColor(...BANNER_RGB);
          doc.rect(14, cursorY - 4.5, pageWidth - 28, 6.5, "F");
          doc.setTextColor(...BANNER_TEXT_RGB);
          doc.setFontSize(10);
          doc.setFont("helvetica", "bold");
          doc.text(section.title, 16, cursorY);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(0, 0, 0);
          cursorY += 4;
          autoTable(doc, {
            startY: cursorY,
            head: [section.rows[0]],
            body: section.rows.slice(1),
            styles: { fontSize: 8, cellPadding: 1.5 },
            headStyles: { fillColor: BANNER_RGB, textColor: BANNER_TEXT_RGB, fontStyle: "bold" },
            // Same green/red percentage fill as the dashboard's own PctCell
            // and the Excel export's writePct -- autoTable has no per-cell
            // "kind" of its own, so detect it from the already-formatted
            // "+12.34%"/"-1.23%" string instead of threading extra metadata
            // through buildFortnightlyExportSections just for this. The
            // section's own cellColors (e.g. SIP/Equity AUM's gradient,
            // which needs an arbitrary interpolated RGB pair, not just a
            // sign) take priority when present, since the sign-based regex
            // would otherwise mark that column always-green.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            didParseCell: (data: any) => {
              if (data.section !== "body") return;
              const override = section.cellColors?.[data.row.index]?.[data.column.index];
              if (override) {
                data.cell.styles.fillColor = override.fill;
                data.cell.styles.textColor = override.text;
                data.cell.styles.fontStyle = "bold";
                return;
              }
              const text = String(data.cell.raw ?? "").trim();
              if (/^[+-]?\d[\d,.]*%$/.test(text)) {
                const positive = !text.startsWith("-");
                data.cell.styles.fillColor = positive ? POS_RGB : NEG_RGB;
                data.cell.styles.textColor = positive ? POS_TEXT_RGB : NEG_TEXT_RGB;
                data.cell.styles.fontStyle = "bold";
              }
            },
            margin: { left: 14, right: 14 },
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cursorY = (doc as any).lastAutoTable.finalY + 10;
        }
      }
      const dateStamp = new Date().toISOString().slice(0, 10);
      doc.save(`Fortnightly_AMC_Update_${dateStamp}.pdf`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to build PDF file");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
      <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Download</span>
      {selected.map((amcId) => (
        <span key={amcId} className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs font-medium">
          {nameById.get(amcId) ?? amcId}
          <button
            type="button"
            onClick={() => remove(amcId)}
            aria-label={`Remove ${nameById.get(amcId) ?? amcId}`}
            className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          >
            ×
          </button>
        </span>
      ))}
      {availableToAdd.length > 0 && (
        <select value="" onChange={(e) => add(Number(e.target.value))} aria-label="Add an AMC to the download" className={addSelectClass}>
          <option value="">+ Add AMC…</option>
          {availableToAdd.map((a) => (
            <option key={a.amcId} value={a.amcId}>
              {a.overviewName}
            </option>
          ))}
        </select>
      )}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={handleDownloadExcel}
          disabled={selected.length === 0 || downloading !== null}
          className="rounded-md border px-3 py-1.5 text-xs hover:border-foreground/40 disabled:opacity-50"
        >
          {downloading === "excel" ? "Building…" : "Download Excel"}
        </button>
        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={selected.length === 0 || downloading !== null}
          className="rounded-md border px-3 py-1.5 text-xs hover:border-foreground/40 disabled:opacity-50"
        >
          {downloading === "pdf" ? "Building…" : "Download PDF"}
        </button>
      </div>
    </div>
  );
}
