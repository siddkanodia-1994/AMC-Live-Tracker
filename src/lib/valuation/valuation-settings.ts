// The Valuation Model's saved choices (stored with the Stock
// Correlation defaults). No imports on purpose: correlation-defaults.ts and
// target-price.ts both use these, and target-price.ts reaches
// correlation-defaults.ts through fortnightly-update.ts -- a shared leaf
// module keeps that from becoming an import cycle.

/** AUM averaging choices for the Ratio and Best fit inputs (0 = live, today's value). */
export const VALUATION_AUM_DAYS_OPTIONS = [
  { value: 0, label: "Live" },
  { value: 5, label: "5D avg" },
  { value: 10, label: "10D avg" },
  { value: 15, label: "15D avg" },
  { value: 20, label: "20D avg" },
  { value: 45, label: "45D avg" },
] as const;

export const DEFAULT_VALUATION_RATIO_DAYS = 45;
export const DEFAULT_BEST_FIT_AUM_DAYS = 45;
export const DEFAULT_BEST_FIT_AUM_PCT = 10;

export function isValuationAumDays(value: unknown): value is number {
  return typeof value === "number" && VALUATION_AUM_DAYS_OPTIONS.some((o) => o.value === value);
}

/** The Best fit AUM move, in % (0 ≤ x < 100). */
export function isBestFitAumPct(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 100;
}

/** The Ratio's "Today's AUM" choices: the AUM multiplied into the mean ratio (and ±1 SD). */
export const RATIO_TODAY_AUM_OPTIONS = [
  { value: 0, label: "Live" },
  { value: 5, label: "5D avg" },
  { value: 10, label: "10D avg" },
  { value: 20, label: "20D avg" },
  { value: 45, label: "45D avg" },
] as const;

/** The two typed day boxes (Ratio history AUM avg, Best fit line moving avg). */
export const MIN_VALUATION_AVG_DAYS = 1;
export const MAX_VALUATION_AVG_DAYS = 250;

export function isValuationAvgDays(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_VALUATION_AVG_DAYS && value <= MAX_VALUATION_AVG_DAYS;
}
