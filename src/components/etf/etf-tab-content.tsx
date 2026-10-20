"use client";

import { useState } from "react";
import { EtfTable } from "./etf-table";
import { EtfOverviewStyleTable } from "./etf-overview-style-table";

// Top-level switch between the Overview-tab-style layout (quarter pickers,
// Average/Exit toggle, Price/Flow/Total QoQ columns) and the original
// per-asset-class layout (quarterly Reported AUM, today's NAV-ratio Live
// AUM) -- both kept per the user's own decision, rather than replacing one
// with the other.
export function EtfTabContent() {
  const [overviewStyle, setOverviewStyle] = useState(true);

  return (
    <div className="space-y-3">
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
      {overviewStyle ? <EtfOverviewStyleTable /> : <EtfTable />}
    </div>
  );
}
