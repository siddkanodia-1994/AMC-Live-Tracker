import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings, foreignInstrumentMap, foreignPriceCache, holdings } from "../db/schema";
import { getQuote, searchByIsin, throttledForEach } from "../finnhub/client";
import { getUsdInrRate } from "../fx/client";
import { isUsListedEquityIsin } from "../excel/instrument-classification";
import { writeIsinDailyPriceRows, type IsinDailyPriceRow } from "./isin-price-store";
import { lastTradingDayIstString } from "../utils/market-hours";
import foreignSymbolOverridesJson from "../../../data/foreign-symbol-overrides.json";

// Hand-verified ISIN -> Finnhub symbol pairs for holdings whose ISIN
// Finnhub's search can't resolve (mostly ADRs/GDRs and a share class or
// two). Each was checked by quoting the symbol and comparing it with the
// holding's own implied price (reported value / shares) against the
// distribution for already-mapped holdings. Consulted before the search,
// so a re-sync never drops them.
const FOREIGN_SYMBOL_OVERRIDES = new Map(
  (foreignSymbolOverridesJson as { isin: string; symbol: string; companyName: string }[]).map((o) => [o.isin, o])
);

const USD_INR_RATE_KEY = "usd_inr_rate";
const USD_INR_RATE_AS_OF_KEY = "usd_inr_rate_as_of";

function todayIst(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

async function getDistinctUsListedIsins(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ isin: holdings.isin })
    .from(holdings)
    .where(and(eq(holdings.isPriceable, false), isNotNull(holdings.isin)));

  return rows.map((r) => r.isin).filter((isin): isin is string => isin !== null && isUsListedEquityIsin(isin));
}

export interface SyncForeignInstrumentsResult {
  upserted: number;
  unmatchedIsins: string[];
}

/** Resolves ISIN -> Finnhub ticker for every US-listed holding. Rare/manual, like DHAN's instrument sync. */
export async function syncForeignInstrumentMap(
  onProgress?: (done: number, total: number) => void
): Promise<SyncForeignInstrumentsResult> {
  const isins = await getDistinctUsListedIsins();
  const unmatchedIsins: string[] = [];
  let upserted = 0;

  await throttledForEach(
    isins,
    async (isin) => {
      const override = FOREIGN_SYMBOL_OVERRIDES.get(isin);
      const match = override ? { symbol: override.symbol, companyName: override.companyName } : await searchByIsin(isin);
      if (!match) {
        unmatchedIsins.push(isin);
        return;
      }
      await db
        .insert(foreignInstrumentMap)
        .values({ isin, symbol: match.symbol, companyName: match.companyName })
        .onConflictDoUpdate({
          target: foreignInstrumentMap.isin,
          set: { symbol: match.symbol, companyName: match.companyName, updatedAt: new Date() },
        });
      upserted++;
    },
    onProgress
  );

  return { upserted, unmatchedIsins };
}

export interface RefreshForeignPricesResult {
  updated: number;
  failed: number;
  usdInrRate: number | null;
}

/**
 * Refreshes today's USD price cache for every mapped US-listed holding, plus
 * the USD/INR rate. Meant to run twice/day (see refresh-foreign-prices.yml).
 *
 * Also seeds one real historical anchor point per ISIN: Finnhub's free
 * /quote response already includes `pc` (the prior trading session's close)
 * alongside the current price -- previously fetched and discarded. Since
 * Finnhub's historical-candles endpoint is premium-only (confirmed via a
 * live 403), this `pc` field is the only historical US-equity data
 * available on the free tier at all. Converted to INR with this same run's
 * rate and written into isin_daily_price tagged as "yesterday" (the most
 * recent trading day before now), it gives the Overview's "1 Day Change"
 * column a real (not synthetic) prior value for US-listed holdings, which
 * previously had none -- see the EOD-persistence audit. Necessarily only a
 * rolling 2-day window (today + yesterday), never a deeper backfill, since
 * /quote has no date parameter.
 */
export async function refreshForeignPrices(
  onProgress?: (done: number, total: number) => void
): Promise<RefreshForeignPricesResult> {
  const mapped = await db.select().from(foreignInstrumentMap);
  const today = todayIst();
  const usdInrRate = await getUsdInrRate();
  const previousTradingDay = lastTradingDayIstString();
  let updated = 0;
  let failed = 0;
  const previousCloseRows: IsinDailyPriceRow[] = [];

  await throttledForEach(
    mapped,
    async (row) => {
      const quote = await getQuote(row.symbol);
      if (quote === null) {
        failed++;
        return;
      }
      await db
        .insert(foreignPriceCache)
        .values({ isin: row.isin, priceUsd: String(quote.current), asOfDate: today })
        .onConflictDoUpdate({
          target: foreignPriceCache.isin,
          set: { priceUsd: String(quote.current), asOfDate: today, updatedAt: new Date() },
        });
      updated++;

      if (quote.previousClose !== null && usdInrRate !== null) {
        previousCloseRows.push({
          isin: row.isin,
          snapshotDate: previousTradingDay,
          priceInr: quote.previousClose * usdInrRate,
        });
      }
    },
    onProgress
  );

  await writeIsinDailyPriceRows(previousCloseRows);

  if (usdInrRate !== null) {
    await db
      .insert(appSettings)
      .values({ key: USD_INR_RATE_KEY, value: String(usdInrRate) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: String(usdInrRate), updatedAt: new Date() } });
    await db
      .insert(appSettings)
      .values({ key: USD_INR_RATE_AS_OF_KEY, value: today })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: today, updatedAt: new Date() } });
  }

  return { updated, failed, usdInrRate };
}

export interface CachedUsdInrRate {
  rate: number;
  /** IST date the rate was fetched; null for rows written before it was tracked. */
  asOfDate: string | null;
}

export async function getCachedUsdInrRate(): Promise<CachedUsdInrRate | null> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(inArray(appSettings.key, [USD_INR_RATE_KEY, USD_INR_RATE_AS_OF_KEY]));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const rate = Number(byKey.get(USD_INR_RATE_KEY));
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return { rate, asOfDate: byKey.get(USD_INR_RATE_AS_OF_KEY) ?? null };
}

export interface CachedForeignPrice {
  priceUsd: number;
  /** IST date the quote was fetched (see refreshForeignPrices), not the US trading date. */
  asOfDate: string;
}

export async function getAllForeignPrices(): Promise<Map<string, CachedForeignPrice>> {
  const rows = await db
    .select({ isin: foreignPriceCache.isin, priceUsd: foreignPriceCache.priceUsd, asOfDate: foreignPriceCache.asOfDate })
    .from(foreignPriceCache);
  return new Map(rows.map((r) => [r.isin, { priceUsd: Number(r.priceUsd), asOfDate: r.asOfDate }]));
}
