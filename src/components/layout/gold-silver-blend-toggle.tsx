"use client";

import { useState } from "react";
import { useGoldSilverBlend } from "./gold-silver-blend-context";

const TITLE =
  "For whichever AMC(s) are checked below, folds that AMC's combined Gold + Silver ETF Average AUM (from the Gold & Silver ETF tab) into its Equity Average AUM everywhere on the dashboard -- Overview, Stock Correlation, and Fortnightly tabs, including every correlation/ratio figure derived from it. A day with no Gold/Silver data for that AMC simply isn't added (equity-only for that day), never treated as an error.";

export function GoldSilverBlendToggle() {
  const { enabled, setEnabled, selectedAmcIds, toggleAmcId, listedAmcs } = useGoldSilverBlend();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setEnabled(!enabled)}
          aria-pressed={enabled}
          title={TITLE}
          className={
            enabled
              ? "rounded-md bg-foreground px-2 py-1 text-xs text-background"
              : "rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          }
        >
          Incl. Gold/Silver AUM: {enabled ? "On" : "Off"}
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          title="Choose which AMC(s) this applies to"
          className="rounded-md border px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {selectedAmcIds.length > 0 ? `${selectedAmcIds.length} ▾` : "▾"}
        </button>
      </div>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 rounded-md border bg-card p-2 shadow-md">
          <p className="mb-1 px-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
            Apply to
          </p>
          <div className="max-h-64 overflow-y-auto">
            {listedAmcs.map((amc) => (
              <label key={amc.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                <input type="checkbox" checked={selectedAmcIds.includes(amc.id)} onChange={() => toggleAmcId(amc.id)} />
                {amc.overviewName}
              </label>
            ))}
            {listedAmcs.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground">Loading…</p>}
          </div>
        </div>
      )}
    </div>
  );
}
