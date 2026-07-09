import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings, foreignInstrumentMap, foreignPriceCache, holdings } from "../db/schema";
import { getQuote, searchByIsin, throttledForEach } from "../finnhub/client";
import { getUsdInrRate } from "../fx/client";
import { isUsListedEquityIsin } from "../excel/instrument-classification";

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
      const match = await searchByIsin(isin);
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

/** Refreshes today's USD price cache for every mapped US-listed holding, plus the USD/INR rate. Meant to run once/day. */
export async function refreshForeignPrices(
  onProgress?: (done: number, total: number) => void
): Promise<RefreshForeignPricesResult> {
  const mapped = await db.select().from(foreignInstrumentMap);
  const today = todayIst();
  let updated = 0;
  let failed = 0;

  await throttledForEach(
    mapped,
    async (row) => {
      const price = await getQuote(row.symbol);
      if (price === null) {
        failed++;
        return;
      }
      await db
        .insert(foreignPriceCache)
        .values({ isin: row.isin, priceUsd: String(price), asOfDate: today })
        .onConflictDoUpdate({
          target: foreignPriceCache.isin,
          set: { priceUsd: String(price), asOfDate: today, updatedAt: new Date() },
        });
      updated++;
    },
    onProgress
  );

  const usdInrRate = await getUsdInrRate();
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

export async function getCachedUsdInrRate(): Promise<number | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, USD_INR_RATE_KEY));
  if (!row) return null;
  const rate = Number(row.value);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export async function getAllForeignPrices(): Promise<Map<string, number>> {
  const rows = await db.select({ isin: foreignPriceCache.isin, priceUsd: foreignPriceCache.priceUsd }).from(foreignPriceCache);
  return new Map(rows.map((r) => [r.isin, Number(r.priceUsd)]));
}
