import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings } from "../db/schema";
import { getIstDateString } from "../utils/date";

function dismissalKey(date: string): string {
  return `lastclose_dismissed_${date}`;
}

/**
 * ISINs dismissed for today via the Overview banner's "Ignore for today" --
 * server-side and shared across every visitor (appSettings is a plain
 * key-value table, keyed per IST date so it naturally resets at midnight,
 * no cron/cleanup needed).
 */
export async function getDismissedIsinsForToday(): Promise<Set<string>> {
  const key = dismissalKey(getIstDateString());
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  if (!row) return new Set();
  try {
    const parsed = JSON.parse(row.value);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

/**
 * Overwrites (not merges) today's dismissed set -- a re-dismiss after a new
 * stock joins the flagged set captures the new full set in one call.
 */
export async function dismissLastCloseStocksForToday(isins: string[]): Promise<void> {
  const key = dismissalKey(getIstDateString());
  const value = JSON.stringify(isins);
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}
