import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { liveAumFetchLease } from "../db/schema";
import type { ComputedLiveAum } from "./types";

// Module-scope in-memory cache — no dedicated Postgres cache table (see plan).
// Not shared across concurrent serverless instances; acceptable for
// personal-scale traffic where the worst case is one extra DHAN call, never
// incorrect data. Upgrade path: swap for Upstash/Vercel KV if this ever matters.
interface CacheEntry {
  result: ComputedLiveAum;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

export function getCachedLiveAum(reportPeriod: string): ComputedLiveAum | null {
  if (!cache) return null;
  if (cache.result.snapshot.reportPeriod !== reportPeriod) return null;
  if (Date.now() > cache.expiresAt) return null;
  return cache.result;
}

export function setCachedLiveAum(result: ComputedLiveAum, ttlMs: number): void {
  cache = { result, expiresAt: Date.now() + ttlMs };
}

// Holdings (per reportPeriod) and instrument_map only change on an explicit
// admin action (workbook upload, instrument sync) -- not every 45s poll like
// live prices -- so they get their own longer-TTL caches, invalidated
// immediately by those two routes (see invalidateLiveAumCache below) rather
// than relying on the TTL alone. This is the fix for the two full-table
// reads that were re-downloading `holdings`/`instrument_map` in their
// entirety on every poll, a top contributor to the Neon egress-quota
// exhaustion this fixes.
//
// 15 days, not a shorter safety-margin TTL: the explicit invalidation above
// is the real mechanism for the normal case (an /admin upload clears this
// instantly), AND a brand-new current-period upload is separately
// self-correcting regardless of TTL -- getCachedHoldings is keyed by
// reportPeriod, so a new month's holdings can never be confused with the
// previous month's cached entry; a cache "hit" on the wrong period is
// impossible by construction, only a slower-than-ideal miss is possible.
// The TTL only ever matters as a fallback for a same-period correction
// applied through a path that bypasses the explicit invalidation entirely
// (e.g. a script writing directly to the database) -- audited and accepted
// as a rare, low-blast-radius edge case worth trading for the egress
// savings of (near) eliminating market-hours re-fetches of these two
// tables, which otherwise re-download in full every 10 minutes all day.
const STATIC_TABLE_CACHE_TTL_MS = 15 * 24 * 60 * 60 * 1000;

interface StaticCacheEntry<T> {
  reportPeriod?: string;
  rows: T;
  expiresAt: number;
}

let holdingsCache: StaticCacheEntry<unknown[]> | null = null;
let instrumentMapCache: StaticCacheEntry<unknown[]> | null = null;

export function getCachedHoldings<T>(reportPeriod: string): T | null {
  if (!holdingsCache) return null;
  if (holdingsCache.reportPeriod !== reportPeriod) return null;
  if (Date.now() > holdingsCache.expiresAt) return null;
  return holdingsCache.rows as T;
}

export function setCachedHoldings<T extends unknown[]>(reportPeriod: string, rows: T): void {
  holdingsCache = { reportPeriod, rows, expiresAt: Date.now() + STATIC_TABLE_CACHE_TTL_MS };
}

export function getCachedInstrumentMap<T>(): T | null {
  if (!instrumentMapCache) return null;
  if (Date.now() > instrumentMapCache.expiresAt) return null;
  return instrumentMapCache.rows as T;
}

export function setCachedInstrumentMap<T extends unknown[]>(rows: T): void {
  instrumentMapCache = { rows, expiresAt: Date.now() + STATIC_TABLE_CACHE_TTL_MS };
}

export function invalidateLiveAumCache(): void {
  cache = null;
  holdingsCache = null;
  instrumentMapCache = null;
}

const DHAN_LEASE_ID = "dhan_ltp_fetch";

/**
 * Atomically claims the cross-instance DHAN-fetch lease (see dhan-lease.ts):
 * succeeds only if no lease row exists yet, or the existing one has already
 * expired -- per Postgres's own now(), never a caller's local clock, so this
 * is immune to inter-instance clock skew by construction. A single
 * self-contained INSERT...ON CONFLICT...WHERE...RETURNING statement, not a
 * pg_advisory_lock: this app's db client (neon-http) is a stateless
 * per-query HTTP driver with no persistent session for a lock to survive
 * across (see schema.ts's liveAumFetchLease comment for the full reasoning).
 */
export async function claimDhanFetchLease(ownerToken: string, ttlMs: number): Promise<boolean> {
  const rows = await db
    .insert(liveAumFetchLease)
    .values({ id: DHAN_LEASE_ID, ownerToken, leaseExpiresAt: new Date(Date.now() + ttlMs) })
    .onConflictDoUpdate({
      target: liveAumFetchLease.id,
      set: { ownerToken, leaseExpiresAt: new Date(Date.now() + ttlMs), updatedAt: sql`now()` },
      setWhere: sql`${liveAumFetchLease.leaseExpiresAt} < now()`,
    })
    .returning({ ownerToken: liveAumFetchLease.ownerToken });
  return rows.length > 0 && rows[0].ownerToken === ownerToken;
}

/**
 * Releases the lease immediately after a real DHAN call finishes (success or
 * failure) so the next legitimate cycle doesn't wait out the full TTL -- the
 * TTL is only a safety net for an instance killed mid-flight (e.g. a hard
 * Vercel function timeout) before it can release. Guarded by ownerToken so a
 * late/slow release can never clear a different, newer holder's lease.
 */
export async function releaseDhanFetchLease(ownerToken: string): Promise<void> {
  await db
    .update(liveAumFetchLease)
    .set({ leaseExpiresAt: sql`now()` })
    .where(and(eq(liveAumFetchLease.id, DHAN_LEASE_ID), eq(liveAumFetchLease.ownerToken, ownerToken)));
}
