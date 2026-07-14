import { getActiveDhanClientId, getActiveDhanToken } from "./token";
import type { ExchangeSegment } from "./types";

const DHAN_HISTORICAL_URL = "https://api.dhan.co/v2/charts/historical";
// DHAN's documented limit for the historical/charts data API is 5
// requests/sec; paced well under that (~2/sec) as a real safety margin --
// a prior full-history backfill run silently lost ~20-25% of otherwise
// real, available data to some transient failure mode that never showed
// up in logs (nothing here logged status/error bodies) and was never
// retried. See RETRY_ATTEMPTS/RETRY_BACKOFF_MS below.
const HISTORICAL_REQUEST_INTERVAL_MS = 500;
const RETRY_ATTEMPTS = 3; // 1 initial + 2 retries
const RETRY_BACKOFF_MS = 1500;

interface DhanHistoricalResponseBody {
  close?: number[];
  timestamp?: number[];
}

export interface HistoricalClose {
  date: string; // "YYYY-MM-DD", IST calendar date
  close: number;
}

function timestampToIstDate(timestampSeconds: number): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(timestampSeconds * 1000 + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHistoricalClosesOnce(
  securityId: string,
  exchangeSegment: ExchangeSegment,
  fromDate: string,
  toDateInclusive: string
): Promise<{ closes: HistoricalClose[] | null; retryable: boolean; detail: string }> {
  let token: string;
  let clientId: string;
  try {
    token = await getActiveDhanToken();
    clientId = await getActiveDhanClientId();
  } catch (err) {
    return { closes: null, retryable: false, detail: err instanceof Error ? err.message : "credentials unavailable" };
  }

  const toDateExclusive = new Date(`${toDateInclusive}T00:00:00Z`);
  toDateExclusive.setUTCDate(toDateExclusive.getUTCDate() + 1);

  try {
    const res = await fetch(DHAN_HISTORICAL_URL, {
      method: "POST",
      headers: {
        "access-token": token,
        "client-id": clientId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        securityId,
        exchangeSegment,
        instrument: "EQUITY",
        expiryCode: 0,
        oi: false,
        fromDate,
        toDate: toDateExclusive.toISOString().slice(0, 10),
      }),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      // DH-905 is DHAN's own "no data present for this instrument/range"
      // response -- a genuine, confirmed absence, not worth retrying.
      // Everything else (5xx, unexpected 4xx, malformed body) is treated
      // as potentially transient and gets retried.
      const isConfirmedNoData = bodyText.includes("DH-905");
      return {
        closes: null,
        retryable: !isConfirmedNoData,
        detail: `HTTP ${res.status}: ${bodyText.slice(0, 300)}`,
      };
    }

    const json = (await res.json()) as DhanHistoricalResponseBody;
    if (!json.close || !json.timestamp || json.close.length !== json.timestamp.length) {
      return { closes: null, retryable: true, detail: "malformed response body (missing/mismatched close+timestamp arrays)" };
    }

    return {
      closes: json.timestamp.map((ts, i) => ({ date: timestampToIstDate(ts), close: json.close![i] })),
      retryable: false,
      detail: "",
    };
  } catch (err) {
    return { closes: null, retryable: true, detail: err instanceof Error ? err.message : "unknown fetch exception" };
  }
}

/**
 * Fetches daily EOD closes for one security over a date range. `toDate` is
 * treated as inclusive by the caller (this function adds a day internally,
 * since DHAN's API treats its own `toDate` as non-inclusive). Retries
 * transient failures (network errors, 5xx, malformed bodies) up to
 * RETRY_ATTEMPTS times with a backoff before giving up; DHAN's own
 * "confirmed no data" response (DH-905) is not retried. Returns an empty
 * array (never throws) once retries are exhausted -- but now logs exactly
 * why, so a silent data gap is visible instead of indistinguishable from
 * "DHAN genuinely has nothing here."
 */
export async function fetchHistoricalCloses(
  securityId: string,
  exchangeSegment: ExchangeSegment,
  fromDate: string,
  toDateInclusive: string
): Promise<HistoricalClose[]> {
  let lastDetail = "";
  let attemptsMade = 0;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    attemptsMade = attempt;
    const result = await fetchHistoricalClosesOnce(securityId, exchangeSegment, fromDate, toDateInclusive);
    if (result.closes !== null) return result.closes;
    lastDetail = result.detail;
    if (!result.retryable) break;
    if (attempt < RETRY_ATTEMPTS) {
      console.error(
        `[historical-client] retrying ${exchangeSegment}:${securityId} (attempt ${attempt}/${RETRY_ATTEMPTS} failed): ${lastDetail}`
      );
      await sleep(RETRY_BACKOFF_MS);
    }
  }
  console.error(`[historical-client] giving up on ${exchangeSegment}:${securityId} after ${attemptsMade} attempt(s): ${lastDetail}`);
  return [];
}

/**
 * Sequentially fetches historical closes for many securities, throttled to
 * a conservative pace well under DHAN's documented 5 requests/sec limit
 * for the historical/charts endpoint. One request per security (each
 * returns its whole date range in one response).
 */
export async function fetchHistoricalClosesForMany(
  requests: { securityId: string; exchangeSegment: ExchangeSegment }[],
  fromDate: string,
  toDateInclusive: string,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, HistoricalClose[]>> {
  const results = new Map<string, HistoricalClose[]>();

  for (let i = 0; i < requests.length; i++) {
    const { securityId, exchangeSegment } = requests[i];
    const closes = await fetchHistoricalCloses(securityId, exchangeSegment, fromDate, toDateInclusive);
    results.set(`${exchangeSegment}:${securityId}`, closes);
    onProgress?.(i + 1, requests.length);

    if (i < requests.length - 1) {
      await sleep(HISTORICAL_REQUEST_INTERVAL_MS);
    }
  }

  return results;
}
