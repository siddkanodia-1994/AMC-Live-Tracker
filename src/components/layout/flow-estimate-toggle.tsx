"use client";

import { useFlowEstimateDisplay } from "./flow-estimate-context";

export function FlowEstimateToggle() {
  const { includeFlowEstimate, setIncludeFlowEstimate } = useFlowEstimateDisplay();

  return (
    <button
      type="button"
      onClick={() => setIncludeFlowEstimate(!includeFlowEstimate)}
      aria-pressed={includeFlowEstimate}
      title="Add this period's last known net flow (scaled by how long it's been since the last report) on top of pure mark-to-market Live AUM totals. An estimate, not a reported figure -- affects only aggregate AUM cards, never Holdings or per-stock values."
      className={
        includeFlowEstimate
          ? "rounded-md bg-foreground px-2 py-1 text-xs text-background"
          : "rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      }
    >
      Incl. Est. Flow: {includeFlowEstimate ? "On" : "Off"}
    </button>
  );
}
