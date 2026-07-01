import { DHAN_MAX_INSTRUMENTS_PER_REQUEST, DHAN_REQUEST_INTERVAL_MS } from "../utils/constants";
import { getActiveDhanToken } from "./token";
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

function requireClientId(): string {
  const clientId = process.env.DHAN_CLIENT_ID;
  if (!clientId) throw new Error("DHAN_CLIENT_ID is not configured");
  return clientId;
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
    clientId = requireClientId();
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
