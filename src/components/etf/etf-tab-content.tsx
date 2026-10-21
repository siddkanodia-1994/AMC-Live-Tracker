"use client";

import { useState } from "react";
import { EtfTable } from "./etf-table";
import { EtfOverviewStyleTable } from "./etf-overview-style-table";

// Full daily Modified-Dietz audit trail (NAV, price-only AUM, flow,
// quarter average) for the top-5 Gold + top-5 Silver AMCs, back to each
// scheme's own earliest real anchor -- generated server-side (see
// /api/etf-detailed-export's own comment for why) since it's a
// meaningfully larger export than anything else in this app.
function DownloadDetailedExcelButton() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch("/api/etf-detailed-export");
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Request failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition");
      const match = disposition?.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? "Gold_Silver_ETF_Daily_Detail.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={downloading}
        className="rounded-lg border bg-[var(--toolbar-accent-soft)]/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
        title="Daily NAV, price-only AUM, flow, and quarter-average detail for the top-5 Gold + top-5 Silver AMCs, back to each scheme's earliest real data."
      >
        {downloading ? "Generating…" : "Download Detailed Excel"}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

// Top-level switch between the Overview-tab-style layout (quarter pickers,
// Average/Exit toggle, Price/Flow/Total QoQ columns) and the original
// per-asset-class layout (quarterly Reported AUM, today's NAV-ratio Live
// AUM) -- both kept per the user's own decision, rather than replacing one
// with the other.
export function EtfTabContent() {
  const [overviewStyle, setOverviewStyle] = useState(true);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOverviewStyle(true)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              overviewStyle ? "border-[var(--toolbar-accent)] bg-[var(--toolbar-accent)] text-white" : "bg-[var(--toolbar-accent-soft)]/40 text-muted-foreground"
            }`}
          >
            Overview format
          </button>
          <button
            type="button"
            onClick={() => setOverviewStyle(false)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
              !overviewStyle ? "border-[var(--toolbar-accent)] bg-[var(--toolbar-accent)] text-white" : "bg-[var(--toolbar-accent-soft)]/40 text-muted-foreground"
            }`}
          >
            Current format
          </button>
        </div>
        <DownloadDetailedExcelButton />
      </div>
      {overviewStyle ? <EtfOverviewStyleTable /> : <EtfTable />}
    </div>
  );
}
