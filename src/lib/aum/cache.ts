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
const STATIC_TABLE_CACHE_TTL_MS = 10 * 60_000;

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
