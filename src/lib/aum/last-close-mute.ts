import { and, eq, inArray, not } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings, isinLastCloseLog, isinManualMute } from "../db/schema";
import { isTradingDay, toIstDateString } from "../utils/market-hours";

const THRESHOLD_KEY = "last_close_auto_mute_threshold_days";
const DEFAULT_THRESHOLD_DAYS = 5;

/**
 * Bulk-logs "this ISIN was last_close on this trading date" -- called once
 * daily from the 4:05pm IST close-capture cron (not the 45s organic poll),
 * so a transient intraday blip doesn't count as a full missed day. Idempotent
 * per (isin, date), matching the cron's own retry-safety.
 */
export async function recordLastCloseLog(date: string, isins: string[]): Promise<void> {
  if (isins.length === 0) return;
  await db
    .insert(isinLastCloseLog)
    .values(isins.map((isin) => ({ isin, snapshotDate: date })))
    .onConflictDoNothing({ target: [isinLastCloseLog.isin, isinLastCloseLog.snapshotDate] });
}

/**
 * Deletes isinManualMute rows for any ISIN that's recovered (not in today's
 * last-close set) -- mirrors the auto-mute timer's own "streak resets to 0
 * the moment a live price returns" behavior, so a manually-accepted reason
 * never lingers for a stock that's already back to being priced live.
 */
export async function clearRecoveredManualMutes(currentlyFlaggedIsins: string[]): Promise<void> {
  if (currentlyFlaggedIsins.length === 0) {
    await db.delete(isinManualMute);
    return;
  }
  await db.delete(isinManualMute).where(not(inArray(isinManualMute.isin, currentlyFlaggedIsins)));
}

export async function getAutoMuteThresholdDays(): Promise<number> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, THRESHOLD_KEY));
  const parsed = row ? Number.parseInt(row.value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_THRESHOLD_DAYS;
}

export async function setAutoMuteThresholdDays(days: number): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: THRESHOLD_KEY, value: String(days) })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(days), updatedAt: new Date() } });
}

/**
 * The `n` most recent real trading dates strictly before `dateStr`, newest
 * first -- same backward-walk-with-a-cap shape as lastTradingDayIstString
 * (market-hours.ts), generalized from 1 date to n.
 */
export function lastNTradingDatesBefore(dateStr: string, n: number): string[] {
  const dates: string[] = [];
  let cursor = new Date(`${dateStr}T00:00:00.000Z`);
  let guard = 0;
  while (dates.length < n && guard < n * 3 + 30) {
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
    guard++;
    if (isTradingDay(cursor)) {
      dates.push(toIstDateString(cursor));
    }
  }
  return dates;
}

/**
 * For each currently-flagged ISIN, resolves whether it should be shown as
 * muted -- either because it has an active manual accept (isinManualMute)
 * or because it's completed N consecutive prior trading days of last_close
 * per isinLastCloseLog (today makes N+1, i.e. mute starts the 6th day for
 * the default 5-day threshold). Returns a map to the mute reason (the
 * manually-typed string, or null for a timer-based mute) -- only ISINs that
 * are actually muted appear as keys. Early-exits with no queries when
 * nothing's currently flagged, same efficiency pattern as
 * computeDaysUnchanged in compute-live-aum.ts.
 */
export async function getMutedIsins(currentlyFlaggedIsins: string[]): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (currentlyFlaggedIsins.length === 0) return result;

  const manualRows = await db
    .select()
    .from(isinManualMute)
    .where(inArray(isinManualMute.isin, currentlyFlaggedIsins));
  const manualByIsin = new Map(manualRows.map((r) => [r.isin, r.reason]));

  const stillNeedingStreakCheck = currentlyFlaggedIsins.filter((isin) => !manualByIsin.has(isin));
  for (const [isin, reason] of manualByIsin) result.set(isin, reason);
  if (stillNeedingStreakCheck.length === 0) return result;

  const thresholdDays = await getAutoMuteThresholdDays();
  const today = toIstDateString(new Date());
  const priorDates = lastNTradingDatesBefore(today, thresholdDays);
  if (priorDates.length < thresholdDays) return result; // not enough trading history yet to ever mute

  const logRows = await db
    .select()
    .from(isinLastCloseLog)
    .where(and(inArray(isinLastCloseLog.isin, stillNeedingStreakCheck), inArray(isinLastCloseLog.snapshotDate, priorDates)));

  const loggedDatesByIsin = new Map<string, Set<string>>();
  for (const r of logRows) {
    const set = loggedDatesByIsin.get(r.isin);
    if (set) set.add(r.snapshotDate);
    else loggedDatesByIsin.set(r.isin, new Set([r.snapshotDate]));
  }

  for (const isin of stillNeedingStreakCheck) {
    const logged = loggedDatesByIsin.get(isin);
    const hasFullStreak = logged !== undefined && priorDates.every((d) => logged.has(d));
    if (hasFullStreak) result.set(isin, null);
  }

  return result;
}

export async function acceptLastCloseReason(isin: string, reason: string): Promise<void> {
  await db
    .insert(isinManualMute)
    .values({ isin, reason })
    .onConflictDoUpdate({ target: isinManualMute.isin, set: { reason, mutedAt: new Date() } });
}
