import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings } from "../db/schema";
import { RANGE_OPTIONS, type RangeOption } from "../aum/date-range";
import type { ExitRule, PositionSizing } from "./engine";

const SETTINGS_KEY = "backtest_defaults";

const EXIT_RULES: ExitRule[] = ["fixed_holding", "mean_revert", "combo"];
const POSITION_SIZINGS: PositionSizing[] = ["equal_weight", "fixed_capital"];

export interface BacktestDefaults {
  amcSlug: string;
  range: RangeOption;
  thresholdsInput: string;
  maDays: number;
  exitRule: ExitRule;
  holdingDays: number;
  meanRevertTargetZ: number;
  entryLagDays: number;
  transactionCostBps: number;
  initialCapital: number;
  positionSizing: PositionSizing;
  positionSizeFraction: number;
  fixedCapitalPerTrade: number;
}

const FALLBACK_DEFAULTS: BacktestDefaults = {
  amcSlug: "hdfc-mutual-fund",
  range: "3y",
  thresholdsInput: "-1.5, -2.0",
  maDays: 15,
  exitRule: "combo",
  holdingDays: 20,
  meanRevertTargetZ: 0,
  entryLagDays: 1,
  transactionCostBps: 10,
  initialCapital: 1_000_000,
  positionSizing: "equal_weight",
  positionSizeFraction: 100,
  fixedCapitalPerTrade: 100_000,
};

function isRangeOption(value: unknown): value is RangeOption {
  return typeof value === "string" && RANGE_OPTIONS.some((o) => o.value === value);
}

function isExitRule(value: unknown): value is ExitRule {
  return typeof value === "string" && EXIT_RULES.includes(value as ExitRule);
}

function isPositionSizing(value: unknown): value is PositionSizing {
  return typeof value === "string" && POSITION_SIZINGS.includes(value as PositionSizing);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * The Backtest tab's saved global default (which AMC, and its full config
 * panel) -- shared by every visitor until someone next saves a new one
 * (see setBacktestDefaults, deliberately open to any visitor, not
 * admin-gated -- same explicit product choice already made for the Stock
 * Correlation tab's own default). Falls back to FALLBACK_DEFAULTS if
 * nothing's ever been saved, or if the stored JSON is malformed/stale.
 */
export async function getBacktestDefaults(): Promise<BacktestDefaults> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY));
  if (!row) return FALLBACK_DEFAULTS;
  try {
    const parsed = JSON.parse(row.value) as Partial<BacktestDefaults>;
    return {
      amcSlug: typeof parsed.amcSlug === "string" && parsed.amcSlug.length > 0 ? parsed.amcSlug : FALLBACK_DEFAULTS.amcSlug,
      range: isRangeOption(parsed.range) ? parsed.range : FALLBACK_DEFAULTS.range,
      thresholdsInput: typeof parsed.thresholdsInput === "string" && parsed.thresholdsInput.length > 0 ? parsed.thresholdsInput : FALLBACK_DEFAULTS.thresholdsInput,
      maDays: finiteOr(parsed.maDays, FALLBACK_DEFAULTS.maDays),
      exitRule: isExitRule(parsed.exitRule) ? parsed.exitRule : FALLBACK_DEFAULTS.exitRule,
      holdingDays: finiteOr(parsed.holdingDays, FALLBACK_DEFAULTS.holdingDays),
      meanRevertTargetZ: finiteOr(parsed.meanRevertTargetZ, FALLBACK_DEFAULTS.meanRevertTargetZ),
      entryLagDays: finiteOr(parsed.entryLagDays, FALLBACK_DEFAULTS.entryLagDays),
      transactionCostBps: finiteOr(parsed.transactionCostBps, FALLBACK_DEFAULTS.transactionCostBps),
      initialCapital: finiteOr(parsed.initialCapital, FALLBACK_DEFAULTS.initialCapital),
      positionSizing: isPositionSizing(parsed.positionSizing) ? parsed.positionSizing : FALLBACK_DEFAULTS.positionSizing,
      positionSizeFraction: finiteOr(parsed.positionSizeFraction, FALLBACK_DEFAULTS.positionSizeFraction),
      fixedCapitalPerTrade: finiteOr(parsed.fixedCapitalPerTrade, FALLBACK_DEFAULTS.fixedCapitalPerTrade),
    };
  } catch {
    return FALLBACK_DEFAULTS;
  }
}

export async function setBacktestDefaults(defaults: BacktestDefaults): Promise<void> {
  const value = JSON.stringify(defaults);
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}
