import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings } from "../db/schema";
import { RANGE_OPTIONS, type RangeOption } from "../aum/date-range";
import { RATIO_BASIS_OPTIONS, type RatioBasis } from "../aum/series-math";
import { EXTRA_LAG_OPTIONS } from "./regression-engine";

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
  // true no-op for the ratio columns (today's same-day behavior,
  // unchanged); the regression columns always add their own +1 session
  // floor on top of this regardless. See stock-correlation-table.tsx.
  extraLagDays: number;
}

const FALLBACK_DEFAULTS: StockCorrelationDefaults = {
  range: "3y",
  maDays: 0,
  ratioBasis: "mean",
  aumOnlyAveraging: false,
  levelsCorrelation: false,
  extraLagDays: 0,
};

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
    return {
      range: isRangeOption(parsed.range) ? parsed.range : FALLBACK_DEFAULTS.range,
      maDays: Number.isFinite(parsed.maDays) && (parsed.maDays as number) >= 0 ? Number(parsed.maDays) : FALLBACK_DEFAULTS.maDays,
      ratioBasis: isRatioBasis(parsed.ratioBasis) ? parsed.ratioBasis : FALLBACK_DEFAULTS.ratioBasis,
      aumOnlyAveraging: typeof parsed.aumOnlyAveraging === "boolean" ? parsed.aumOnlyAveraging : FALLBACK_DEFAULTS.aumOnlyAveraging,
      levelsCorrelation: typeof parsed.levelsCorrelation === "boolean" ? parsed.levelsCorrelation : FALLBACK_DEFAULTS.levelsCorrelation,
      extraLagDays: isExtraLagDays(parsed.extraLagDays) ? parsed.extraLagDays : FALLBACK_DEFAULTS.extraLagDays,
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
