"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useFlowEstimateDisplay } from "@/components/layout/flow-estimate-context";
import { useFortnightlyEligibleAmcs } from "@/hooks/use-fortnightly-update";
import { buildFortnightlyExportSections, buildFortnightlySheetExcel } from "@/lib/aum/fortnightly-export";
import type { FortnightlySheet } from "@/lib/aum/fortnightly-update";

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

const addSelectClass =
  "min-w-0 max-w-[240px] rounded-md border border-dashed bg-background px-2 py-1 text-sm text-muted-foreground hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

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
        let cursorY = 14;
        doc.setFontSize(14);
        doc.text(sections[0].title, 14, cursorY);
        cursorY += 8;
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
            // section's own cellColors (e.g. SIP/Equity AUM, a LEVEL that's
            // always positive and needs a comparison-based rule instead of
            // sign-based) take priority when present, since the sign-based
            // regex would otherwise mark that column always-green.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            didParseCell: (data: any) => {
              if (data.section !== "body") return;
              const override = section.cellColors?.[data.row.index]?.[data.column.index];
              if (override) {
                const positive = override === "pos";
                data.cell.styles.fillColor = positive ? POS_RGB : NEG_RGB;
                data.cell.styles.textColor = positive ? POS_TEXT_RGB : NEG_TEXT_RGB;
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
