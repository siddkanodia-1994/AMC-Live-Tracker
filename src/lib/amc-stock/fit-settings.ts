// AMC Analytics' Ratio / Regression saved view (Range, Moving avg, AUM-only
// avg, Levels): validated here, apart from the DB-bound defaults module, so
// the save route's rules are unit-testable.

import { RANGE_OPTIONS, type RangeOption } from "../aum/date-range";

export interface FitSettings {
  fitRange: RangeOption;
  fitMaDays: number;
  fitAumOnlyAveraging: boolean;
  fitLevelsCorrelation: boolean;
  fitSavedAt: string | null;
}

/** Ratio / Regression's Moving avg: a whole number of days, 1–250 (the input's own clamp). */
export function isFitMaDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 250;
}

/**
 * The fit settings a save stores. Each field is optional in the request
 * (every other "Save as default" omits or echoes them) and kept as stored
 * when omitted. fitSavedAt moves to `nowIso` only when one of the four
 * actually changes, so echoing them back from another save keeps the time.
 */
export function resolveFitSettings(
  body: Record<string, unknown> | null | undefined,
  stored: FitSettings,
  nowIso: string
): { ok: true; value: FitSettings } | { ok: false; error: string } {
  const fitRange = body?.fitRange ?? stored.fitRange;
  const fitMaDays = body?.fitMaDays ?? stored.fitMaDays;
  const fitAumOnlyAveraging = body?.fitAumOnlyAveraging ?? stored.fitAumOnlyAveraging;
  const fitLevelsCorrelation = body?.fitLevelsCorrelation ?? stored.fitLevelsCorrelation;
  if (!RANGE_OPTIONS.some((o) => o.value === fitRange)) {
    return { ok: false, error: `fitRange must be one of ${RANGE_OPTIONS.map((o) => o.value).join(", ")}` };
  }
  if (!isFitMaDays(fitMaDays)) return { ok: false, error: "fitMaDays must be a whole number of days from 1 to 250" };
  if (typeof fitAumOnlyAveraging !== "boolean") return { ok: false, error: "fitAumOnlyAveraging must be a boolean" };
  if (typeof fitLevelsCorrelation !== "boolean") return { ok: false, error: "fitLevelsCorrelation must be a boolean" };
  const changed =
    fitRange !== stored.fitRange ||
    fitMaDays !== stored.fitMaDays ||
    fitAumOnlyAveraging !== stored.fitAumOnlyAveraging ||
    fitLevelsCorrelation !== stored.fitLevelsCorrelation;
  return {
    ok: true,
    value: {
      fitRange: fitRange as RangeOption,
      fitMaDays,
      fitAumOnlyAveraging,
      fitLevelsCorrelation,
      fitSavedAt: changed ? nowIso : stored.fitSavedAt,
    },
  };
}
