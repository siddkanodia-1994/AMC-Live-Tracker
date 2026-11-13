"use client";

import { fitStrength } from "@/lib/amc-stock/fit-stats";
import { formatShortDateWithYear } from "@/lib/utils/format";

// The right half of the Ratio and Regression sections' top card: the fit's
// headline figures as a 2×3 grid -- Period, Corr (with a Strong / Moderate /
// Weak badge), R², one section-specific tile (β for Regression, Z-score for
// Ratio), Days and a closing tile (the basis). Recomputed by the caller from
// the sections' shared controls.

const STRENGTH_LABEL = { strong: "Strong", moderate: "Moderate", weak: "Weak" } as const;

export interface FitTile {
  label: string;
  value: string;
  sub: string;
}

function Tile({ label, value, sub, small = false, valueClass = "" }: FitTile & { small?: boolean; valueClass?: string }) {
  return (
    <div className="aa-fit-tile">
      <div className="aa-fit-k">{label}</div>
      <div className={`aa-fit-v ${small ? "aa-fit-v--sm" : ""} ${valueClass}`}>{value}</div>
      <div className="aa-fit-s">{sub}</div>
    </div>
  );
}

export function FitStatGrid({
  r,
  r2,
  n,
  rangeLabel,
  from,
  to,
  extra,
  closing,
}: {
  r: number | null;
  r2: number | null;
  n: number | null;
  rangeLabel: string;
  /** The fit window's first and last session (YYYY-MM-DD). */
  from: string | null;
  to: string | null;
  extra: FitTile;
  closing: FitTile;
}) {
  const strength = fitStrength(r);
  return (
    <div>
      <div className="aa-fit-k">Fit at these settings</div>
      <div className="aa-fitgrid" role="group" aria-label="Fit statistics">
        <Tile label="Period" value={rangeLabel} sub={from && to ? `${formatShortDateWithYear(from)} → ${formatShortDateWithYear(to)}` : "—"} small />
        <div className="aa-fit-tile">
          <div className="aa-fit-k">Correlation (r)</div>
          <div className={`aa-fit-v ${r === null ? "" : r >= 0 ? "aa-fit-pos" : "aa-fit-neg"}`}>{r === null ? "—" : `${r >= 0 ? "+" : ""}${r.toFixed(2)}`}</div>
          <div className="aa-fit-s">{strength && <span className={`aa-fit-badge aa-fit-badge--${strength}`}>{STRENGTH_LABEL[strength]}</span>}</div>
        </div>
        <Tile label="R²" value={r2 === null ? "—" : r2.toFixed(2)} sub={r2 === null ? "" : `${(r2 * 100).toFixed(1)}% of the price move explained`} />
        <Tile {...extra} small />
        <Tile label="Days" value={n === null ? "—" : n.toLocaleString("en-IN")} sub="sessions in the fit" />
        <Tile {...closing} small />
      </div>
    </div>
  );
}
