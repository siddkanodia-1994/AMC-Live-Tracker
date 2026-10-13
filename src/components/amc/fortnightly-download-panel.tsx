"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useFortnightlyEligibleAmcs } from "@/hooks/use-fortnightly-update";
import { buildFortnightlyExportSections } from "@/lib/aum/fortnightly-export";
import type { FortnightlySheet } from "@/lib/aum/fortnightly-update";

const addSelectClass =
  "min-w-0 max-w-[240px] rounded-md border border-dashed bg-background px-2 py-1 text-sm text-muted-foreground hover:border-foreground/40 focus:outline-none focus:ring-1 focus:ring-foreground/40";

async function fetchLatestSheet(amcId: number): Promise<FortnightlySheet> {
  const res = await fetch(`/api/fortnightly-update?amcId=${amcId}`);
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
      const { utils, writeFileXLSX } = await import("xlsx");
      const workbook = utils.book_new();
      for (const amcId of selected) {
        const sheet = await fetchLatestSheet(amcId);
        const sections = buildFortnightlyExportSections(sheet);
        const aoa: string[][] = [];
        for (const section of sections) {
          aoa.push([section.title]);
          aoa.push(...section.rows);
          aoa.push([]);
        }
        const worksheet = utils.aoa_to_sheet(aoa);
        utils.book_append_sheet(workbook, worksheet, sheet.overviewName.slice(0, 31));
      }
      const dateStamp = new Date().toISOString().slice(0, 10);
      writeFileXLSX(workbook, `Fortnightly_AMC_Update_${dateStamp}.xlsx`);
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
      for (let i = 0; i < selected.length; i++) {
        if (i > 0) doc.addPage();
        const sheet = await fetchLatestSheet(selected[i]);
        const sections = buildFortnightlyExportSections(sheet);
        let cursorY = 14;
        doc.setFontSize(14);
        doc.text(sections[0].title, 14, cursorY);
        cursorY += 6;
        for (const section of sections.slice(1)) {
          doc.setFontSize(11);
          doc.text(section.title, 14, cursorY);
          autoTable(doc, {
            startY: cursorY + 2,
            head: [section.rows[0]],
            body: section.rows.slice(1),
            styles: { fontSize: 8, cellPadding: 1.5 },
            headStyles: { fillColor: [230, 230, 230], textColor: 20 },
            margin: { left: 14, right: 14 },
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cursorY = (doc as any).lastAutoTable.finalY + 8;
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
