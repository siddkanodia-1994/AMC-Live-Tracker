import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings, indexDailyLevel, isinLastCloseLog, liveAumDailySnapshot } from "../db/schema";
import { INDEX_KEYS, type IndexKey } from "../dhan/indices";
import { computeDailyDataQualityForDate } from "./daily-data-quality";

const LOOKBACK_DAYS_KEY = "outage_reclaim_lookback_days";
const THRESHOLD_PCT_KEY = "outage_reclaim_threshold_pct";
const MAX_ISINS_PER_RUN_KEY = "outage_reclaim_max_isins_per_run";

const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_THRESHOLD_PCT = 0.5;
const DEFAULT_MAX_ISINS_PER_RUN = 150;

export async function getOutageLookbackDays(): Promise<number> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, LOOKBACK_DAYS_KEY));
  const parsed = row ? Number.parseInt(row.value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LOOKBACK_DAYS;
}

export async function setOutageLookbackDays(days: number): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: LOOKBACK_DAYS_KEY, value: String(days) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(days), updatedAt: new Date() } });
}

export async function getOutageThresholdPct(): Promise<number> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, THRESHOLD_PCT_KEY));
  const parsed = row ? Number.parseFloat(row.value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : DEFAULT_THRESHOLD_PCT;
}

export async function setOutageThresholdPct(pct: number): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: THRESHOLD_PCT_KEY, value: String(pct) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(pct), updatedAt: new Date() } });
}

export async function getOutageMaxIsinsPerRun(): Promise<number> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, MAX_ISINS_PER_RUN_KEY));
  const parsed = row ? Number.parseInt(row.value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_ISINS_PER_RUN;
}

export async function setOutageMaxIsinsPerRun(n: number): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: MAX_ISINS_PER_RUN_KEY, value: String(n) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(n), updatedAt: new Date() } });
}

/**
 * Real trading dates (a canonical liveAumDailySnapshot row exists) in
 * [windowStart, beforeDate) -- the holiday-safe ground truth both
 * detectAmcOutageDates and detectIndexGapDates anchor to. The cron's
 * Mon-Fri schedule alone doesn't exclude NSE holidays, and on a holiday
 * every priceable ISIN legitimately has no live price -- producing the
 * same "~100% of universe on last_close" signature as a genuine outage.
 * A canonical row is written on every actual trading day (outage or not)
 * but never on a holiday, since computeLiveAum's tradingDay gate blocks it
 * entirely -- so this set is the correct "was this a real trading day"
 * check for both signals below.
 */
export async function getRealTradingDatesInWindow(windowStart: string, beforeDate: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ snapshotDate: liveAumDailySnapshot.snapshotDate })
    .from(liveAumDailySnapshot)
    .where(
      and(
        eq(liveAumDailySnapshot.isCanonical, true),
        gte(liveAumDailySnapshot.snapshotDate, windowStart),
        lt(liveAumDailySnapshot.snapshotDate, beforeDate)
      )
    )
    .orderBy(asc(liveAumDailySnapshot.snapshotDate));
  return rows.map((r) => r.snapshotDate);
}

export interface AmcOutageCandidate {
  snapshotDate: string;
  lastCloseIsinCount: number;
  universeIsinCount: number;
}

/**
 * Flags real trading dates where the fraction of the priceable-ISIN
 * universe logged as last_close (isinLastCloseLog) looks like a genuine
 * DHAN outage rather than ordinary thin-liquidity noise. Steady-state is
 * ~0.3-1.3% of ~1600 ISINs; a total outage is ~95-100% -- the default 50%
 * threshold has large margin either side.
 */
export async function detectAmcOutageDates(options: {
  windowStart: string;
  beforeDate: string;
  thresholdPct?: number;
}): Promise<AmcOutageCandidate[]> {
  const realDates = await getRealTradingDatesInWindow(options.windowStart, options.beforeDate);
  if (realDates.length === 0) return [];

  const thresholdPct = options.thresholdPct ?? (await getOutageThresholdPct());

  const lastCloseRows = await db
    .select({ snapshotDate: isinLastCloseLog.snapshotDate, isin: isinLastCloseLog.isin })
    .from(isinLastCloseLog)
    .where(inArray(isinLastCloseLog.snapshotDate, realDates));

  const isinsByDate = new Map<string, Set<string>>();
  for (const r of lastCloseRows) {
    const set = isinsByDate.get(r.snapshotDate) ?? new Set<string>();
    set.add(r.isin);
    isinsByDate.set(r.snapshotDate, set);
  }

  const candidates: AmcOutageCandidate[] = [];
  for (const date of realDates) {
    const lastCloseIsinCount = isinsByDate.get(date)?.size ?? 0;
    if (lastCloseIsinCount === 0) continue;
    const quality = await computeDailyDataQualityForDate(date);
    const universeIsinCount = quality?.indianStocks ?? 0;
    if (universeIsinCount === 0) continue;
    if (lastCloseIsinCount / universeIsinCount >= thresholdPct) {
      candidates.push({ snapshotDate: date, lastCloseIsinCount, universeIsinCount });
    }
  }
  return candidates;
}

export interface IndexGapCandidate {
  snapshotDate: string;
  missingKeys: IndexKey[];
}

/** Real trading dates where NIFTY 50/500 (or either) has no index_daily_level row. */
export async function detectIndexGapDates(options: { windowStart: string; beforeDate: string }): Promise<IndexGapCandidate[]> {
  const realDates = await getRealTradingDatesInWindow(options.windowStart, options.beforeDate);
  if (realDates.length === 0) return [];

  const existingRows = await db
    .select({ indexKey: indexDailyLevel.indexKey, snapshotDate: indexDailyLevel.snapshotDate })
    .from(indexDailyLevel)
    .where(inArray(indexDailyLevel.snapshotDate, realDates));

  const existingByDate = new Map<string, Set<string>>();
  for (const r of existingRows) {
    const set = existingByDate.get(r.snapshotDate) ?? new Set<string>();
    set.add(r.indexKey);
    existingByDate.set(r.snapshotDate, set);
  }

  const candidates: IndexGapCandidate[] = [];
  for (const date of realDates) {
    const present = existingByDate.get(date) ?? new Set<string>();
    const missingKeys = INDEX_KEYS.filter((k) => !present.has(k));
    if (missingKeys.length > 0) candidates.push({ snapshotDate: date, missingKeys });
  }
  return candidates;
}
