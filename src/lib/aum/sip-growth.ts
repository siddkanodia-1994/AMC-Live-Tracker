// Growth maths for the SIP cards: the same five-period layout the
// Fortnightly AMC Update tab uses (latest, previous, previous-but-one, and
// the same two periods a year earlier), so AMC Analytics' SIP & Score
// section and the Fortnightly cards always agree.

export type SipFive = [number | null, number | null, number | null, number | null, number | null];

export interface SipGrowthRows {
  /** Row-over-row step (QoQ or MoM): rows 0 and 1, plus row 2 when its bases are given. */
  step: SipFive;
  /** Year on year: row 0 vs row 3, row 1 vs row 4, row 2 vs its base. */
  yoy: SipFive;
}

function change(current: number | null, base: number | null): number | null {
  return current !== null && base !== null && base !== 0 ? current / base - 1 : null;
}

/** What row 2 compares against: the period before it, and the same period a year earlier. */
export interface SipThirdRowBases {
  prev: number | null;
  yoy: number | null;
}

export function computeSipGrowth(values: SipFive, thirdRowBases?: SipThirdRowBases): SipGrowthRows {
  const [v0, v1, v2, v3, v4] = values;
  return {
    step: [change(v0, v1), change(v1, v2), thirdRowBases ? change(v2, thirdRowBases.prev) : null, null, null],
    yoy: [change(v0, v3), change(v1, v4), thirdRowBases ? change(v2, thirdRowBases.yoy) : null, null, null],
  };
}

/** Effective value of an overridable cell: the typed value wins over the auto one. */
export function effectiveSipValues(manual: SipFive, auto: SipFive): SipFive {
  return manual.map((m, i) => m ?? auto[i]) as SipFive;
}

/**
 * The AMC's share of industry SIP for each period. Only computed where both
 * cards cover the same period label (the AMC's latest quarter and the
 * industry anchor are picked separately, so they can differ).
 */
export function computeSipShare(
  amc: SipFive,
  amcLabels: readonly string[],
  industry: SipFive,
  industryLabels: readonly string[] | null
): SipFive {
  return amc.map((a, i) => {
    const ind = industry[i];
    if (!industryLabels || amcLabels[i] !== industryLabels[i]) return null;
    return a !== null && ind !== null && ind !== 0 ? a / ind : null;
  }) as SipFive;
}
