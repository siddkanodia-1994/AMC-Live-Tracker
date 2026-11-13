"use client";

import { fitStrength } from "@/lib/amc-stock/fit-stats";

// The right half of the Ratio and Regression sections' top card: the fit's
// Corr (with a Strong / Moderate / Weak badge) and R², as two matching
// tiles. The period, slope / Z-score and session count are already in the
// toolbar, equation and footnote on the left. Recomputed by the caller
// from the sections' shared controls.

const STRENGTH_LABEL = { strong: "Strong", moderate: "Moderate", weak: "Weak" } as const;

export function FitStatGrid({ r, r2 }: { r: number | null; r2: number | null }) {
  const strength = fitStrength(r);
  return (
    <div>
      <div className="aa-fit-k">Fit at these settings</div>
      <div className="aa-fitgrid" role="group" aria-label="Fit statistics">
        <div className="aa-fit-tile">
          <div className="aa-fit-k">Correlation (r)</div>
          <div className={`aa-fit-v ${r === null ? "" : r >= 0 ? "aa-fit-pos" : "aa-fit-neg"}`}>{r === null ? "—" : `${r >= 0 ? "+" : ""}${r.toFixed(2)}`}</div>
          <div className="aa-fit-s">{strength && <span className={`aa-fit-badge aa-fit-badge--${strength}`}>{STRENGTH_LABEL[strength]}</span>}</div>
        </div>
        <div className="aa-fit-tile">
          <div className="aa-fit-k">R²</div>
          <div className="aa-fit-v">{r2 === null ? "—" : r2.toFixed(2)}</div>
          <div className="aa-fit-s">{r2 === null ? "" : `${(r2 * 100).toFixed(1)}% of the price move explained`}</div>
        </div>
      </div>
    </div>
  );
}
