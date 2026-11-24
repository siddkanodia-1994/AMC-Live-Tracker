// Reads and writes the Valuation Model's per-year estimates and its shared
// target year. See target-year.ts for which year lives where.

import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { amcValuationEstimate, appSettings } from "../db/schema";
import { saveAmcAnalyticsField } from "../aum/amc-analytics-inputs";
import { DEFAULT_TARGET_FY, isTargetFy, snapshotFieldFor, type EstimateKind } from "./target-year";

const TARGET_FY_KEY = "valuation_target_fy";

/** Save one year's PAT or revenue where that year lives: the AMC's latest Fortnightly snapshot row, or the estimates table. */
export async function saveValuationEstimate(amcId: number, fiscalYear: number, kind: EstimateKind, value: number | null): Promise<void> {
  const field = snapshotFieldFor(kind, fiscalYear);
  if (field) {
    await saveAmcAnalyticsField(amcId, field, value);
    return;
  }
  const column = kind === "pat" ? "patCr" : "revenueCr";
  const dbValue = value === null ? null : String(value);
  await db
    .insert(amcValuationEstimate)
    .values({ amcId, fiscalYear, [column]: dbValue })
    .onConflictDoUpdate({
      target: [amcValuationEstimate.amcId, amcValuationEstimate.fiscalYear],
      set: { [column]: dbValue, updatedAt: new Date() },
    });
}

/** The shared target year; FY28 until someone picks another. */
export async function getValuationTargetFy(): Promise<number> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, TARGET_FY_KEY));
  const fy = row ? Number(row.value) : NaN;
  return isTargetFy(fy) ? fy : DEFAULT_TARGET_FY;
}

export async function setValuationTargetFy(fy: number): Promise<void> {
  const value = String(fy);
  await db
    .insert(appSettings)
    .values({ key: TARGET_FY_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}
