import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { outageReclaimLog } from "../db/schema";

export type OutageKind = "amc_isin" | "index_level";
export type OutageStatus = "detected" | "corrected" | "no_data" | "failed";

export interface OutageReclaimRow {
  kind: OutageKind;
  snapshotDate: string;
  status: OutageStatus;
  lastCloseIsinCount: number | null;
  universeIsinCount: number | null;
  correctedIsinCount: number | null;
  indexKeysCorrected: string[] | null;
  detail: string | null;
  detectedAt: string;
  correctedAt: string | null;
}

/** First flag of a suspected AMC-side outage date -- never overwrites an existing (already-terminal) row. */
export async function upsertDetectedAmcOutage(
  snapshotDate: string,
  lastCloseIsinCount: number,
  universeIsinCount: number
): Promise<void> {
  await db
    .insert(outageReclaimLog)
    .values({ kind: "amc_isin", snapshotDate, status: "detected", lastCloseIsinCount, universeIsinCount })
    .onConflictDoNothing({ target: [outageReclaimLog.kind, outageReclaimLog.snapshotDate] });
}

/** First flag of a suspected index-level gap date -- same never-overwrite semantics. */
export async function upsertDetectedIndexGap(snapshotDate: string, missingKeys: string[]): Promise<void> {
  await db
    .insert(outageReclaimLog)
    .values({ kind: "index_level", snapshotDate, status: "detected", indexKeysCorrected: missingKeys })
    .onConflictDoNothing({ target: [outageReclaimLog.kind, outageReclaimLog.snapshotDate] });
}

/** Dates still needing correction (freshly detected, or a prior attempt failed), oldest first. */
export async function getPendingDates(kind: OutageKind, beforeDate: string): Promise<string[]> {
  const rows = await getPendingRows(kind, beforeDate);
  return rows.map((r) => r.snapshotDate);
}

/**
 * Same as getPendingDates, but also returns detectedAt -- needed by the
 * AMC-side corrector to tell "already refreshed since this outage was
 * flagged" apart from "still stale," so a single huge outage day can
 * safely resume across multiple cron runs (see outage-reclaim.ts).
 */
export async function getPendingRows(kind: OutageKind, beforeDate: string): Promise<{ snapshotDate: string; detectedAt: Date }[]> {
  return db
    .select({ snapshotDate: outageReclaimLog.snapshotDate, detectedAt: outageReclaimLog.detectedAt })
    .from(outageReclaimLog)
    .where(
      and(
        eq(outageReclaimLog.kind, kind),
        inArray(outageReclaimLog.status, ["detected", "failed"]),
        lt(outageReclaimLog.snapshotDate, beforeDate)
      )
    )
    .orderBy(asc(outageReclaimLog.snapshotDate));
}

export async function markCorrected(
  kind: OutageKind,
  snapshotDate: string,
  patch: { correctedIsinCount?: number; indexKeysCorrected?: string[]; detail?: string }
): Promise<void> {
  await db
    .update(outageReclaimLog)
    .set({ status: "corrected", correctedAt: sql`now()`, ...patch })
    .where(and(eq(outageReclaimLog.kind, kind), eq(outageReclaimLog.snapshotDate, snapshotDate)));
}

export async function markNoData(kind: OutageKind, snapshotDate: string, detail: string): Promise<void> {
  await db
    .update(outageReclaimLog)
    .set({ status: "no_data", correctedAt: sql`now()`, detail })
    .where(and(eq(outageReclaimLog.kind, kind), eq(outageReclaimLog.snapshotDate, snapshotDate)));
}

export async function markFailed(kind: OutageKind, snapshotDate: string, detail: string): Promise<void> {
  await db
    .update(outageReclaimLog)
    .set({ status: "failed", detail })
    .where(and(eq(outageReclaimLog.kind, kind), eq(outageReclaimLog.snapshotDate, snapshotDate)));
}

/**
 * Every amc_isin outage-reclaim row regardless of status, keyed by
 * snapshotDate -- feeds the Daily Data tab's per-row "still reclaiming" vs
 * "rectified" badge (see daily-data-quality.ts), which needs in-progress
 * (`detected`/`failed`) rows too, unlike getRecentOutageReclaims above
 * which only ever returns already-`corrected` ones.
 */
export async function getAllAmcOutageReclaimRows(): Promise<Map<string, OutageReclaimRow>> {
  const rows = await db.select().from(outageReclaimLog).where(eq(outageReclaimLog.kind, "amc_isin"));
  const byDate = new Map<string, OutageReclaimRow>();
  for (const r of rows) {
    byDate.set(r.snapshotDate, {
      kind: r.kind as OutageKind,
      snapshotDate: r.snapshotDate,
      status: r.status as OutageStatus,
      lastCloseIsinCount: r.lastCloseIsinCount,
      universeIsinCount: r.universeIsinCount,
      correctedIsinCount: r.correctedIsinCount,
      indexKeysCorrected: r.indexKeysCorrected,
      detail: r.detail,
      detectedAt: r.detectedAt.toISOString(),
      correctedAt: r.correctedAt ? r.correctedAt.toISOString() : null,
    });
  }
  return byDate;
}

/** Feeds the Overview page's "N days auto-corrected" disclosure -- corrected rows only, most recent first. */
export async function getRecentOutageReclaims(sinceDaysAgo = 30): Promise<OutageReclaimRow[]> {
  const cutoff = new Date(Date.now() - sinceDaysAgo * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(outageReclaimLog)
    .where(and(eq(outageReclaimLog.status, "corrected"), gte(outageReclaimLog.correctedAt, cutoff)))
    .orderBy(desc(outageReclaimLog.snapshotDate));

  return rows.map((r) => ({
    kind: r.kind as OutageKind,
    snapshotDate: r.snapshotDate,
    status: r.status as OutageStatus,
    lastCloseIsinCount: r.lastCloseIsinCount,
    universeIsinCount: r.universeIsinCount,
    correctedIsinCount: r.correctedIsinCount,
    indexKeysCorrected: r.indexKeysCorrected,
    detail: r.detail,
    detectedAt: r.detectedAt.toISOString(),
    correctedAt: r.correctedAt ? r.correctedAt.toISOString() : null,
  }));
}
