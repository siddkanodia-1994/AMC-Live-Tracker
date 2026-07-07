import { DHAN_MAX_INSTRUMENTS_PER_REQUEST, DHAN_REQUEST_INTERVAL_MS } from "../utils/constants";
import { getActiveDhanClientId, getActiveDhanToken } from "./token";
import type { ExchangeSegment, LtpRequestItem, LtpResult } from "./types";

const DHAN_LTP_URL = "https://api.dhan.co/v2/marketfeed/ltp";

interface DhanLtpResponseBody {
  status: string;
  data?: Partial<Record<ExchangeSegment, Record<string, { last_price: number }>>>;
}

export function segmentKey(item: LtpRequestItem): string {
  return `${item.exchangeSegment}:${item.securityId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkRequests(requests: LtpRequestItem[], maxPerChunk: number): LtpRequestItem[][] {
  const chunks: LtpRequestItem[][] = [];
  for (let i = 0; i < requests.length; i += maxPerChunk) {
    chunks.push(requests.slice(i, i + maxPerChunk));
  }
  return chunks;
}

export type DhanCredentialTestResult =
  | { ok: true }
  | { ok: false; status: number | null; message: string };

/**
 * One isolated LTP request for a single instrument, used by the admin
 * settings API to confirm a client-id/token pair actually works before it's
 * persisted -- distinct from fetchLtps, which batches/paces/degrades for the
 * live computation path and never throws.
 */
export async function testDhanCredentials(
  clientId: string,
  token: string,
  sample: { securityId: string; exchangeSegment: ExchangeSegment }
): Promise<DhanCredentialTestResult> {
  try {
    const res = await fetch(DHAN_LTP_URL, {
      method: "POST",
      headers: {
        "access-token": token,
        "client-id": clientId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ [sample.exchangeSegment]: [Number(sample.securityId)] }),
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: "DHAN rejected this client ID/token pair — check both values." };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, message: `DHAN request failed with status ${res.status}` };
    }
    const json = (await res.json()) as DhanLtpResponseBody;
    if (json.status !== "success") {
      return { ok: false, status: res.status, message: `DHAN request returned status "${json.status}"` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, status: null, message: err instanceof Error ? err.message : "Network error calling DHAN" };
  }
}

/**
 * Fetches last-traded prices for a batch of instruments, chunked to DHAN's
 * documented limits (<=1000 instruments/request, 1 request/sec). Never throws:
 * on missing token, expired/invalid token, network error, or partial batch
 * failure, the failing security IDs land in `failedSecurityIds` and `apiError`
 * carries a human-readable reason — callers degrade to fallback pricing rather
 * than aborting the whole computation.
 */
export async function fetchLtps(requests: LtpRequestItem[]): Promise<LtpResult> {
  const pricesBySecurityId = new Map<string, number>();
  const failedSecurityIds = new Set<string>();

  if (requests.length === 0) {
    return { pricesBySecurityId, failedSecurityIds };
  }

  let token: string;
  let clientId: string;
  try {
    token = await getActiveDhanToken();
    clientId = await getActiveDhanClientId();
  } catch (err) {
    for (const r of requests) failedSecurityIds.add(segmentKey(r));
    return {
      pricesBySecurityId,
      failedSecurityIds,
      apiError: err instanceof Error ? err.message : "Failed to prepare DHAN request",
    };
  }

  const chunks = chunkRequests(requests, DHAN_MAX_INSTRUMENTS_PER_REQUEST);
  let lastError: string | undefined;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const payload: Partial<Record<ExchangeSegment, number[]>> = {};
    for (const item of chunk) {
      const list = payload[item.exchangeSegment] ?? [];
      list.push(Number(item.securityId));
      payload[item.exchangeSegment] = list;
    }

    try {
      const res = await fetch(DHAN_LTP_URL, {
        method: "POST",
        headers: {
          "access-token": token,
          "client-id": clientId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (res.status === 401 || res.status === 403) {
        const body = await res.text().catch(() => "");
        lastError = "DHAN token likely expired or invalid — update it in Admin settings.";
        console.error(`[dhan] ${res.status} on LTP request:`, body);
        for (const item of chunk) failedSecurityIds.add(segmentKey(item));
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        lastError = `DHAN request failed with status ${res.status}`;
        console.error(`[dhan] ${res.status} on LTP request:`, body);
        for (const item of chunk) failedSecurityIds.add(segmentKey(item));
        continue;
      }

      const json = (await res.json()) as DhanLtpResponseBody;
      if (json.status !== "success") {
        lastError = `DHAN request returned status "${json.status}"`;
        console.error(`[dhan] non-success LTP response:`, JSON.stringify(json).slice(0, 500));
        for (const item of chunk) failedSecurityIds.add(segmentKey(item));
        continue;
      }

      for (const item of chunk) {
        const priceEntry = json.data?.[item.exchangeSegment]?.[item.securityId];
        if (priceEntry && typeof priceEntry.last_price === "number") {
          pricesBySecurityId.set(segmentKey(item), priceEntry.last_price);
        } else {
          failedSecurityIds.add(segmentKey(item));
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Network error calling DHAN";
      console.error(`[dhan] network error on LTP request:`, err);
      for (const item of chunk) failedSecurityIds.add(segmentKey(item));
    }

    if (i < chunks.length - 1) {
      await sleep(DHAN_REQUEST_INTERVAL_MS);
    }
  }

  return { pricesBySecurityId, failedSecurityIds, apiError: lastError };
}
