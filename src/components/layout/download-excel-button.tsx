"use client";

import { useState } from "react";
import { useExportGetter } from "./export-context";

export function DownloadExcelButton() {
  const getter = useExportGetter();
  const [busy, setBusy] = useState(false);

  // Nothing exportable on this page (e.g. /admin) — keep the header clean.
  if (!getter) return null;

  async function handleClick() {
    if (!getter || busy) return;
    const sheet = getter();
    if (!sheet || sheet.rows.length === 0) return;
    setBusy(true);
    try {
      // Loaded on demand — xlsx is ~large and only needed at download time.
      const { utils, writeFileXLSX } = await import("xlsx");
      const worksheet = utils.json_to_sheet(sheet.rows);
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, worksheet, sheet.sheetName.slice(0, 31));
      writeFileXLSX(workbook, `${sheet.fileName}.xlsx`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="text-sm text-muted-foreground hover:text-foreground px-2 py-1 disabled:opacity-50"
      title="Download the currently shown tab as an Excel file"
    >
      {busy ? "Preparing…" : "Download Excel"}
    </button>
  );
}
