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
