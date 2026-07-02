const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";
// Free tier: 60 calls/minute. Throttled to ~54/min for margin.
const FINNHUB_REQUEST_INTERVAL_MS = 1100;

interface FinnhubSearchResult {
  count: number;
  result: { symbol: string; description: string; displaySymbol: string; type: string }[];
}

interface FinnhubQuote {
  c: number; // current price
  pc: number; // previous close
  t: number; // unix seconds
}

function requireApiKey(): string {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY is not configured");
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves an ISIN to a Finnhub ticker symbol via its symbol-search endpoint. */
export async function searchByIsin(
  isin: string
): Promise<{ symbol: string; companyName: string } | null> {
  const apiKey = requireApiKey();
  try {
    const res = await fetch(`${FINNHUB_BASE_URL}/search?q=${encodeURIComponent(isin)}&token=${apiKey}`);
    if (!res.ok) return null;
    const json = (await res.json()) as FinnhubSearchResult;
    const match = json.result?.find((r) => r.type === "Common Stock") ?? json.result?.[0];
    if (!match?.symbol) return null;
    return { symbol: match.symbol, companyName: match.description };
  } catch {
    return null;
  }
}

/** Current/last price for a symbol. Returns null on any failure (missing key, network, 4xx/5xx). */
export async function getQuote(symbol: string): Promise<number | null> {
  const apiKey = requireApiKey();
  try {
    const res = await fetch(`${FINNHUB_BASE_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`);
    if (!res.ok) return null;
    const json = (await res.json()) as FinnhubQuote;
    return typeof json.c === "number" && json.c > 0 ? json.c : null;
  } catch {
    return null;
  }
}

/**
 * Sequential, throttled batch helper shared by the sync (ISIN search) and
 * refresh (quote) jobs — both are one-call-per-item against the same 60/min
 * limit, just with different per-item work.
 */
export async function throttledForEach<T>(
  items: T[],
  fn: (item: T, index: number) => Promise<void>,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    await fn(items[i], i);
    onProgress?.(i + 1, items.length);
    if (i < items.length - 1) {
      await sleep(FINNHUB_REQUEST_INTERVAL_MS);
    }
  }
}
