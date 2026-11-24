// AMC Analytics' Valuation Model target year (FY28E, FY29E, ...): the year
// the PE and Mcap / Sales targets are built on, then discounted two steps
// back -- FY29 → FY28 → FY27 (current). Pure; shared by client and server.
//
// The two discount rates stay per STEP, not per year (the user's choice):
// the stored "FY27" rate is always the first step (target → target − 1) and
// the "FY26" rate the second (→ target − 2), whichever year is picked.
//
// Where each year's PAT / revenue lives: FY26A–FY28E PAT and FY28E revenue
// in the Fortnightly snapshot's own columns (so the Fortnightly card keeps
// showing and editing them), every other year in amc_valuation_estimate.
// One figure, one place -- nothing is copied or mirrored.

/** Unchanged until someone picks another year: today's FY28E tables. */
export const DEFAULT_TARGET_FY = 2028;
export const MIN_TARGET_FY = 2026;
export const MAX_TARGET_FY = 2040;
/** How many years ahead of the current FY the switch offers. */
export const TARGET_FY_CHOICES = 3;

export function isTargetFy(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_TARGET_FY && value <= MAX_TARGET_FY;
}

/** "FY29" for 2029. */
export function fyLabel(fy: number): string {
  return `FY${String(fy % 100).padStart(2, "0")}`;
}

/** The switch's years: the next three after the current FY, plus the saved one if it has fallen out. */
export function targetYearOptions(currentFy: number, saved: number): number[] {
  const years = Array.from({ length: TARGET_FY_CHOICES }, (_, i) => currentFy + 1 + i);
  if (!years.includes(saved)) years.push(saved);
  return years.sort((a, b) => a - b);
}

export type EstimateKind = "pat" | "revenue";

/** The Fortnightly snapshot columns that hold a year's estimate; any other year is in amc_valuation_estimate. */
export const SNAPSHOT_ESTIMATE_FIELDS = {
  pat: { 2026: "patFy26aCr", 2027: "patFy27eCr", 2028: "patFy28eCr" },
  revenue: { 2028: "revenueFy28eCr" },
} as const satisfies Record<EstimateKind, Record<number, string>>;

export type SnapshotEstimateField = "patFy26aCr" | "patFy27eCr" | "patFy28eCr" | "revenueFy28eCr";

export function snapshotFieldFor(kind: EstimateKind, fy: number): SnapshotEstimateField | null {
  return (SNAPSHOT_ESTIMATE_FIELDS[kind] as Record<number, SnapshotEstimateField>)[fy] ?? null;
}

/** amc_valuation_estimate's rows for one AMC, by fiscal year. */
export type StoredEstimates = Record<number, { patCr: number | null; revenueCr: number | null }>;

type SnapshotEstimates = Record<SnapshotEstimateField, number | null>;

/** One year's PAT or revenue, from wherever that year lives. */
export function estimateFor(snapshot: SnapshotEstimates, stored: StoredEstimates | undefined, kind: EstimateKind, fy: number): number | null {
  const field = snapshotFieldFor(kind, fy);
  if (field) return snapshot[field];
  const row = stored?.[fy];
  return (kind === "pat" ? row?.patCr : row?.revenueCr) ?? null;
}

/**
 * The inputs with the target year's PAT and revenue in the FY28E slots
 * computeValuationBlock and computeTargetPrices read. At FY28 this is the
 * inputs unchanged, so today's figures come out identical.
 */
export function manualForTargetYear<M extends SnapshotEstimates>(manual: M, stored: StoredEstimates | undefined, fy: number): M {
  return {
    ...manual,
    patFy28eCr: estimateFor(manual, stored, "pat", fy),
    revenueFy28eCr: estimateFor(manual, stored, "revenue", fy),
  };
}
