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

export function invalidateLiveAumCache(): void {
  cache = null;
}
