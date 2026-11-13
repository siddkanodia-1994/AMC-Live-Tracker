import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings } from "../db/schema";
import { RANGE_OPTIONS, type RangeOption } from "../aum/date-range";
import { RATIO_BASIS_OPTIONS, type RatioBasis } from "../aum/series-math";
import { EXTRA_LAG_OPTIONS } from "./regression-engine";
import accordCodes from "../../../data/amc-accord-codes.json";
import { DEFAULT_WHAT_IF_AUM_DAYS, isWhatIfAumDays, MAX_AUM_INPUT_CR } from "./aum-what-if";
import {
  DEFAULT_BEST_FIT_AUM_DAYS,
  DEFAULT_BEST_FIT_AUM_PCT,
  DEFAULT_VALUATION_RATIO_DAYS,
  DEFAULT_VALUATION_WEIGHTS,
  isBestFitAumPct,
  isValuationAumDays,
  isValuationAvgDays,
  isValuationWeights,
  type ValuationWeights,
} from "../valuation/valuation-settings";

const SETTINGS_KEY = "stock_correlation_defaults";

export interface StockCorrelationDefaults {
  range: RangeOption;
  maDays: number;
  ratioBasis: RatioBasis;
  // When true, "Moving avg (days)" only smooths AUM -- share price stays
  // raw, so the ratio (and everything derived from it) becomes raw price
  // ÷ avg AUM instead of avg price ÷ avg AUM. See stock-correlation-table.tsx.
  aumOnlyAveraging: boolean;
  // When true, Corr/R² correlate the two series' raw LEVELS directly
  // instead of their day-over-day % change. See computeLevelCorrelationStats.
  levelsCorrelation: boolean;
  // Trading-day lag applied to the AUM side before it's aligned with
  // price -- shared by the ratio-based columns (Corr/R²/Fair Value/
  // Z-score) AND the regression-based Model columns. 0 ("None") is a
  // true same-day pairing for both (the regression's former +1 session
  // floor was removed 2026-11-04). See regression-engine.ts.
  extraLagDays: number;
  // The table's "AUM what-if" inputs (AMC slug -> AUM in ₹ cr) that someone
  // typed and then saved with "Save as default". Rows not listed here use
  // their own AUM moving average. Older saved rows have no such field ({}).
  aumInputs: Record<string, number>;
  // Which AUM the what-if rows start from: 0 (live) or a 5/10/15/20-day
  // average. Independent of maDays. Older saved rows lack it (5).
  whatIfAumDays: number;
  // AMC Analytics' Valuation Model (see src/lib/valuation/target-price.ts):
  // the Ratio method's "Today's AUM" (multiplied into the mean ratio), the
  // Best fit line's starting AUM, and its −/+ % move. Older saved rows lack
  // them (45/45/10). valuationRatioDays once drove the ratio history too.
  valuationRatioDays: number;
  bestFitAumDays: number;
  bestFitAumPct: number;
  // The Ratio's own period and the N-day avg AUM its mean and SD are built
  // on, and the Best fit line's own period and moving average. Older saved
  // rows lack them and fall back to what they used before: the saved range,
  // valuationRatioDays (at least 1) and maDays -- so nothing moves until
  // someone saves new ones.
  valuationRatioRange: RangeOption;
  valuationRatioHistoryDays: number;
  bestFitRange: RangeOption;
  bestFitMaDays: number;
  // The AUM (AMC slug -> ₹ cr) each AMC's Ratio / Best fit uses when its
  // choice above is Custom (CUSTOM_AUM_DAYS). Older saved rows have none ({}).
  valuationRatioCustomAum: Record<string, number>;
  bestFitCustomAum: Record<string, number>;
  // The Target Price Average's weight (%) per method. Older saved rows lack
  // it (35 / 10 / 50 / 5).
  valuationWeights: ValuationWeights;
}

const FALLBACK_DEFAULTS: StockCorrelationDefaults = {
  range: "3y",
  maDays: 0,
  ratioBasis: "mean",
  aumOnlyAveraging: false,
  levelsCorrelation: false,
  extraLagDays: 0,
  aumInputs: {},
  whatIfAumDays: DEFAULT_WHAT_IF_AUM_DAYS,
  valuationRatioDays: DEFAULT_VALUATION_RATIO_DAYS,
  bestFitAumDays: DEFAULT_BEST_FIT_AUM_DAYS,
  bestFitAumPct: DEFAULT_BEST_FIT_AUM_PCT,
  valuationRatioRange: "3y",
  valuationRatioHistoryDays: DEFAULT_VALUATION_RATIO_DAYS,
  bestFitRange: "3y",
  bestFitMaDays: DEFAULT_VALUATION_RATIO_DAYS,
  valuationRatioCustomAum: {},
  bestFitCustomAum: {},
  valuationWeights: DEFAULT_VALUATION_WEIGHTS,
};

// The 8 listed AMCs the Stock Correlation table shows -- the only slugs an
// AUM input can be saved for.
const LISTED_AMC_SLUGS = new Set(Object.values(accordCodes).map((v) => v.slug));

/**
 * Keeps only valid AUM inputs: a known listed-AMC slug mapped to a finite
 * number in (0, MAX_AUM_INPUT_CR). Returns null when `value` isn't a plain
 * object at all, so the API can 400 it; bad entries inside are dropped.
 */
export function sanitizeAumInputs(value: unknown): Record<string, number> | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [slug, v] of Object.entries(value as Record<string, unknown>)) {
    if (LISTED_AMC_SLUGS.has(slug) && typeof v === "number" && Number.isFinite(v) && v > 0 && v < MAX_AUM_INPUT_CR) out[slug] = v;
  }
  return out;
}

function isRangeOption(value: unknown): value is RangeOption {
  return typeof value === "string" && RANGE_OPTIONS.some((o) => o.value === value);
}

function isRatioBasis(value: unknown): value is RatioBasis {
  return typeof value === "string" && RATIO_BASIS_OPTIONS.some((o) => o.value === value);
}

function isExtraLagDays(value: unknown): value is number {
  return typeof value === "number" && EXTRA_LAG_OPTIONS.some((o) => o.value === value);
}

/**
 * The Stock Correlation tab's saved global default (range/moving-avg/ratio
 * basis) -- shared by every visitor until someone next saves a new one (see
 * setStockCorrelationDefaults, deliberately open to any visitor, not
 * admin-gated -- an explicit product choice for this one setting). Falls
 * back to FALLBACK_DEFAULTS if nothing's ever been saved, or if the stored
 * JSON is malformed/stale (e.g. a range value from a since-removed option).
 */
export async function getStockCorrelationDefaults(): Promise<StockCorrelationDefaults> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY));
  if (!row) return FALLBACK_DEFAULTS;
  try {
    const parsed = JSON.parse(row.value) as Partial<StockCorrelationDefaults>;
    const range = isRangeOption(parsed.range) ? parsed.range : FALLBACK_DEFAULTS.range;
    const maDays = Number.isFinite(parsed.maDays) && (parsed.maDays as number) >= 0 ? Number(parsed.maDays) : FALLBACK_DEFAULTS.maDays;
    const valuationRatioDays = isValuationAumDays(parsed.valuationRatioDays) ? parsed.valuationRatioDays : FALLBACK_DEFAULTS.valuationRatioDays;
    return {
      range,
      maDays,
      ratioBasis: isRatioBasis(parsed.ratioBasis) ? parsed.ratioBasis : FALLBACK_DEFAULTS.ratioBasis,
      aumOnlyAveraging: typeof parsed.aumOnlyAveraging === "boolean" ? parsed.aumOnlyAveraging : FALLBACK_DEFAULTS.aumOnlyAveraging,
      levelsCorrelation: typeof parsed.levelsCorrelation === "boolean" ? parsed.levelsCorrelation : FALLBACK_DEFAULTS.levelsCorrelation,
      extraLagDays: isExtraLagDays(parsed.extraLagDays) ? parsed.extraLagDays : FALLBACK_DEFAULTS.extraLagDays,
      aumInputs: sanitizeAumInputs(parsed.aumInputs) ?? FALLBACK_DEFAULTS.aumInputs,
      whatIfAumDays: isWhatIfAumDays(parsed.whatIfAumDays) ? parsed.whatIfAumDays : FALLBACK_DEFAULTS.whatIfAumDays,
      valuationRatioDays,
      bestFitAumDays: isValuationAumDays(parsed.bestFitAumDays) ? parsed.bestFitAumDays : FALLBACK_DEFAULTS.bestFitAumDays,
      bestFitAumPct: isBestFitAumPct(parsed.bestFitAumPct) ? parsed.bestFitAumPct : FALLBACK_DEFAULTS.bestFitAumPct,
      valuationRatioRange: isRangeOption(parsed.valuationRatioRange) ? parsed.valuationRatioRange : range,
      valuationRatioHistoryDays: isValuationAvgDays(parsed.valuationRatioHistoryDays)
        ? parsed.valuationRatioHistoryDays
        : Math.max(1, valuationRatioDays),
      bestFitRange: isRangeOption(parsed.bestFitRange) ? parsed.bestFitRange : range,
      bestFitMaDays: isValuationAvgDays(parsed.bestFitMaDays) ? parsed.bestFitMaDays : Math.max(1, Math.min(250, Math.round(maDays))),
      valuationRatioCustomAum: sanitizeAumInputs(parsed.valuationRatioCustomAum) ?? {},
      bestFitCustomAum: sanitizeAumInputs(parsed.bestFitCustomAum) ?? {},
      valuationWeights: isValuationWeights(parsed.valuationWeights) ? parsed.valuationWeights : FALLBACK_DEFAULTS.valuationWeights,
    };
  } catch {
    return FALLBACK_DEFAULTS;
  }
}

export async function setStockCorrelationDefaults(defaults: StockCorrelationDefaults): Promise<void> {
  const value = JSON.stringify(defaults);
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}
