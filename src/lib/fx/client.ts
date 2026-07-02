// Free, no-key-required endpoint from ExchangeRate-API (open.er-api.com),
// updated daily. Attribution required by their terms — see the note near
// where converted values are shown in the UI.
const FX_RATE_URL = "https://open.er-api.com/v6/latest/USD";

interface FxRateResponse {
  result: string;
  rates?: Record<string, number>;
}

/** USD -> INR rate, or null on any failure (network, unexpected shape). */
export async function getUsdInrRate(): Promise<number | null> {
  try {
    const res = await fetch(FX_RATE_URL);
    if (!res.ok) return null;
    const json = (await res.json()) as FxRateResponse;
    const rate = json.rates?.INR;
    return typeof rate === "number" && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}
