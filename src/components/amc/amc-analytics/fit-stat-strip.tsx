"use client";

import { fitStrength } from "@/lib/amc-stock/fit-stats";

// The Ratio and Regression sections' headline fit figures: Corr (with a
// Strong / Moderate / Weak badge), R², one section-specific tile (the basis
// for Ratio, the slope for Regression) and the days in the window. Recomputed
// by the caller from the sections' shared controls.

const STRENGTH_LABEL = { strong: "Strong", moderate: "Moderate", weak: "Weak" } as const;

export interface FitTile {
  label: string;
  value: string;
  sub: string;
}

export function FitStatStrip({
  r,
  r2,
  n,
  rangeLabel,
  third,
}: {
  r: number | null;
  r2: number | null;
  n: number | null;
  rangeLabel: string;
  third: FitTile;
}) {
  const strength = fitStrength(r);
  return (
    <div className="aa-fit" role="group" aria-label="Fit statistics">
      <div className="aa-fit-tile">
        <div className="aa-fit-k">Correlation (r)</div>
        <div className={`aa-fit-v ${r === null ? "" : r >= 0 ? "aa-fit-pos" : "aa-fit-neg"}`}>
          {r === null ? "—" : `${r >= 0 ? "+" : ""}${r.toFixed(2)}`}
        </div>
        <div className="aa-fit-s">{strength && <span className={`aa-fit-badge aa-fit-badge--${strength}`}>{STRENGTH_LABEL[strength]}</span>}</div>
      </div>
      <div className="aa-fit-tile">
        <div className="aa-fit-k">R²</div>
        <div className="aa-fit-v">{r2 === null ? "—" : r2.toFixed(2)}</div>
        <div className="aa-fit-s">{r2 === null ? "" : `${(r2 * 100).toFixed(1)}% of the price move explained`}</div>
      </div>
      <div className="aa-fit-tile">
        <div className="aa-fit-k">{third.label}</div>
        <div className="aa-fit-v aa-fit-v--sm">{third.value}</div>
        <div className="aa-fit-s">{third.sub}</div>
      </div>
      <div className="aa-fit-tile">
        <div className="aa-fit-k">Days</div>
        <div className="aa-fit-v">{n === null ? "—" : n.toLocaleString("en-IN")}</div>
        <div className="aa-fit-s">{rangeLabel} window</div>
      </div>
    </div>
  );
}
