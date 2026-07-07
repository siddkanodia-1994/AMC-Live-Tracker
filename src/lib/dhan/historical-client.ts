import { getActiveDhanClientId, getActiveDhanToken } from "./token";
import type { ExchangeSegment } from "./types";

const DHAN_HISTORICAL_URL = "https://api.dhan.co/v2/charts/historical";
// DHAN's documented limit for the historical/charts data API: 5 requests/sec.
const HISTORICAL_REQUEST_INTERVAL_MS = 210;

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

/**
 * Fetches daily EOD closes for one security over a date range. `toDate` is
 * treated as inclusive by the caller (this function adds a day internally,
 * since DHAN's API treats its own `toDate` as non-inclusive). Returns an
 * empty array (never throws) on any failure — the newly-listed-stock and
 * expired-token cases should degrade the same way the live LTP client does.
 */
export async function fetchHistoricalCloses(
  securityId: string,
  exchangeSegment: ExchangeSegment,
  fromDate: string,
  toDateInclusive: string
): Promise<HistoricalClose[]> {
  let token: string;
  let clientId: string;
  try {
    token = await getActiveDhanToken();
    clientId = await getActiveDhanClientId();
  } catch {
    return [];
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
      return [];
    }

    const json = (await res.json()) as DhanHistoricalResponseBody;
    if (!json.close || !json.timestamp || json.close.length !== json.timestamp.length) {
      return [];
    }

    return json.timestamp.map((ts, i) => ({
      date: timestampToIstDate(ts),
      close: json.close![i],
    }));
  } catch {
    return [];
  }
}

/**
 * Sequentially fetches historical closes for many securities, throttled to
 * DHAN's 5 requests/sec limit for the historical/charts endpoint. One request
 * per security (each returns its whole date range in one response).
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
