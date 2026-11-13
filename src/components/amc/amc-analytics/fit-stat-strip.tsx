"use client";

import { fitStrength } from "@/lib/amc-stock/fit-stats";

// The right half of the Ratio and Regression sections' top card: the fit's
// Corr (with a Strong / Moderate / Weak badge) and R², as two matching
// tiles. The period, slope / Z-score and session count are already in the
// toolbar, equation and footnote on the left. Recomputed by the caller
// from the sections' shared controls.

const STRENGTH_LABEL = { strong: "Strong", moderate: "Moderate", weak: "Weak" } as const;

/** A fraction as a % to 1 decimal, e.g. 0.6953 → "69.5%". */
function pct1(v: number): string {
  return `${Math.abs(v * 100).toFixed(1)}%`;
}

export function FitStatGrid({ r, r2 }: { r: number | null; r2: number | null }) {
  // The badge judges the figure as shown, so 69.95% (shown 70.0%) reads Strong.
  const strength = fitStrength(r === null ? null : Math.round(r * 1000) / 1000);
  return (
    <div>
      <div className="aa-fit-k">Fit at these settings</div>
      <div className="aa-fitgrid" role="group" aria-label="Fit statistics">
        <div className="aa-fit-tile">
          <div className="aa-fit-k">Correlation (r)</div>
          <div className={`aa-fit-v ${r === null ? "" : r >= 0 ? "aa-fit-pos" : "aa-fit-neg"}`}>{r === null ? "—" : `${r >= 0 ? "+" : "−"}${pct1(r)}`}</div>
          <div className="aa-fit-s">{strength && <span className={`aa-fit-badge aa-fit-badge--${strength}`}>{STRENGTH_LABEL[strength]}</span>}</div>
        </div>
        <div className="aa-fit-tile">
          <div className="aa-fit-k">R²</div>
          <div className="aa-fit-v">{r2 === null ? "—" : pct1(r2)}</div>
          <div className="aa-fit-s">{r2 === null ? "" : "of the price move explained"}</div>
        </div>
      </div>
    </div>
  );
}
