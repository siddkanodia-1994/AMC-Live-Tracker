import { randomUUID } from "node:crypto";
import { fetchLtps } from "../dhan/client";
import type { LtpRequestItem, LtpResult } from "../dhan/types";
import { claimDhanFetchLease, releaseDhanFetchLease } from "./cache";

// Generous margin over the realistic ~1-8s worst case for the current
// 2-chunk fetch (DHAN paces its own chunks 1s apart internally) -- only
// matters as a safety net for an instance killed mid-flight, since the
// normal path releases immediately in a `finally` the moment fetchLtps
// returns.
const LEASE_TTL_MS = 20_000;
// Forced calls (cron, admin reclaim, ?refresh=1) must guarantee a genuine
// attempt within their own maxDuration budgets (180s/30s) -- comfortably
// room for several retries.
const FORCED_RETRY_BUDGET_MS = 15_000;
const RETRY_INTERVAL_MS = 1_000;
// Organic 45s-poll traffic: one short, cheap retry, then give up and let
// the existing last-close/stale-fallback ladder handle it this cycle --
// the next poll (or this same lease's holder finishing) resolves it.
const ORGANIC_RETRY_DELAY_MS = 750;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LeasedLtpResult extends LtpResult {
  // True when this call never reached DHAN because another instance held
  // the fetch lease the whole time -- distinct from a genuine DHAN
  // failure. Callers must NOT treat this as a dhanStatus "unavailable"/
  // "degraded" signal or count it toward lastCloseStocks/
  // distinctLastCloseCount (see compute-live-aum.ts) -- a routine,
  // benign skip must never look like a real DHAN outage.
  leaseSkipped?: boolean;
}

/**
 * fetchLtps, gated by the cross-instance DHAN-fetch lease (cache.ts) --
 * ensures at most one Vercel serverless instance is ever mid-flight
 * calling DHAN's rate-limited LTP endpoint at a time, closing the
 * confirmed cause of the 2026-08-06 production 429 (multiple concurrent
 * instances each independently calling DHAN when their unsynchronized
 * in-memory cache TTLs happened to expire close together).
 */
export async function fetchLtpsWithLease(requests: LtpRequestItem[], forceRefresh: boolean): Promise<LeasedLtpResult> {
  const ownerToken = randomUUID();
  const deadline = Date.now() + (forceRefresh ? FORCED_RETRY_BUDGET_MS : ORGANIC_RETRY_DELAY_MS);
  let attempts = 0;

  for (;;) {
    attempts++;
    let won: boolean;
    try {
      won = await claimDhanFetchLease(ownerToken, LEASE_TTL_MS);
    } catch (err) {
      // Lease coordination itself unavailable (e.g. a transient Neon blip)
      // -- fail open to a direct DHAN call rather than degrading every
      // holding just because Postgres, not DHAN, had a bad moment.
      console.error("[live-aum] lease claim failed, calling DHAN directly:", err);
      return fetchLtps(requests);
    }

    if (won) {
      try {
        return await fetchLtps(requests);
      } finally {
        releaseDhanFetchLease(ownerToken).catch((err) => console.error("[live-aum] failed to release DHAN fetch lease:", err));
      }
    }

    if (Date.now() >= deadline || (!forceRefresh && attempts >= 2)) {
      return { pricesBySecurityId: new Map(), failedSecurityIds: new Set(), leaseSkipped: true };
    }
    await sleep(forceRefresh ? RETRY_INTERVAL_MS : ORGANIC_RETRY_DELAY_MS);
  }
}
