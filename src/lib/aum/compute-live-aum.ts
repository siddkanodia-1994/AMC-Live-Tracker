import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, amcs, appSettings, holdings, instrumentMap, liveAumDailySnapshot } from "../db/schema";
import { fetchLtps, segmentKey } from "../dhan/client";
import type { ExchangeSegment, LtpRequestItem } from "../dhan/types";
import { isDebtInstrument, isUsListedEquityIsin } from "../excel/instrument-classification";
import { getAllForeignPrices, getCachedUsdInrRate } from "./foreign-pricing";
import { CRORE, LIVE_AUM_CACHE_TTL_MS } from "../utils/constants";
import { getCachedLiveAum, setCachedLiveAum } from "./cache";
import { getAverageAumSinceReport } from "./history";
import type {
  AmcLiveAum,
  ComputedLiveAum,
  DhanStatus,
  HoldingLiveView,
  LiveAumSnapshot,
  PriceSource,
} from "./types";

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";

export class NoDataImportedError extends Error {
  constructor() {
    super("No Excel file has been imported yet — upload one from /admin to get started.");
    this.name = "NoDataImportedError";
  }
}

async function getCurrentReportPeriod(): Promise<string> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, CURRENT_REPORT_PERIOD_KEY));
  if (!row) throw new NoDataImportedError();
  return row.value;
}

function getIstDateString(): string {
  // Server runs in UTC on Vercel; shift to IST (UTC+5:30) so the daily
  // snapshot's "today" aligns with Indian trading-day boundaries.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(Date.now() + IST_OFFSET_MS);
  return istTime.toISOString().slice(0, 10);
}

async function writeDailySnapshot(snapshot: LiveAumSnapshot): Promise<void> {
  try {
    const today = getIstDateString();
    await db
      .insert(liveAumDailySnapshot)
      .values(
        snapshot.amcs.map((amc) => ({
          amcId: amc.amcId,
          snapshotDate: today,
          reportPeriod: amc.reportPeriod,
          liveAumCr: String(amc.liveAumCr),
          reportedAumCr: String(amc.reportedAumCr),
          deltaCr: String(amc.deltaCr),
          deltaPct: String(amc.deltaPct),
        }))
      )
      .onConflictDoNothing({
        target: [liveAumDailySnapshot.amcId, liveAumDailySnapshot.snapshotDate],
      });
  } catch (err) {
    console.error("Failed to write daily live-AUM snapshot:", err);
  }
}

async function runComputation(): Promise<ComputedLiveAum> {
  const reportPeriod = await getCurrentReportPeriod();

  const periodRows = await db
    .select({
      amcId: amcPeriods.amcId,
      slug: amcs.slug,
      overviewName: amcs.overviewName,
      reportedAumCr: amcPeriods.reportedAumCr,
      residualPlugCr: amcPeriods.residualPlugCr,
    })
    .from(amcPeriods)
    .innerJoin(amcs, eq(amcPeriods.amcId, amcs.id))
    .where(eq(amcPeriods.reportPeriod, reportPeriod));

  const holdingRows = await db.select().from(holdings).where(eq(holdings.reportPeriod, reportPeriod));
  const instrumentRows = await db.select().from(instrumentMap);

  const instrumentByIsin = new Map(instrumentRows.map((r) => [r.isin, r]));

  const priceableIsins = new Set<string>();
  for (const h of holdingRows) {
    if (h.isPriceable && h.isin) priceableIsins.add(h.isin);
  }

  const isinToKey = new Map<string, string>();
  const requests: LtpRequestItem[] = [];
  for (const isin of priceableIsins) {
    const mapping = instrumentByIsin.get(isin);
    if (!mapping) continue;
    const item: LtpRequestItem = {
      securityId: mapping.securityId,
      exchangeSegment: mapping.exchangeSegment as ExchangeSegment,
    };
    isinToKey.set(isin, segmentKey(item));
    requests.push(item);
  }

  const ltpResult = await fetchLtps(requests);
  const [foreignPrices, usdInrRate] = await Promise.all([
    getAllForeignPrices().catch(() => new Map<string, number>()),
    getCachedUsdInrRate().catch(() => null),
  ]);

  const holdingsByAmcId = new Map<number, HoldingLiveView[]>();
  const amcResults: AmcLiveAum[] = [];
  let totalFailed = 0;
  let totalPriceable = 0;

  // De-duplicated by ISIN across every AMC, for industry-wide totals — a
  // stock held by 50 of 56 AMCs is one distinct holding, not 50. Classification
  // (debt/live) is the same regardless of which AMC holds it, since pricing is
  // fetched once per ISIN and reused everywhere it appears (see priceableIsins
  // above), so "first write wins" here is never actually a conflict in practice.
  const distinctIsinInfo = new Map<string, { isDebt: boolean; isLive: boolean }>();

  for (const period of periodRows) {
    const amcHoldingRows = holdingRows.filter((h) => h.amcId === period.amcId);
    const holdingViews: HoldingLiveView[] = [];
    let stalePricedCount = 0;
    let livePricedCount = 0;
    let debtInstrumentCount = 0;
    let liveHoldingsSumCr = 0;

    for (const h of amcHoldingRows) {
      const reportedMarketValueCr = Number(h.marketValueCr);
      let priceSource: PriceSource;
      let liveMarketValueCr: number;
      let livePriceInr: number | null = null;

      if (isDebtInstrument(h.sector, h.companyName)) debtInstrumentCount++;

      if (h.isPriceable && h.isin) {
        totalPriceable++;
        const key = isinToKey.get(h.isin);
        const price = key ? ltpResult.pricesBySecurityId.get(key) : undefined;
        if (price !== undefined) {
          priceSource = "live";
          livePriceInr = price;
          liveMarketValueCr = (price * Number(h.shares)) / CRORE;
          livePricedCount++;
        } else {
          priceSource = "stale_fallback";
          liveMarketValueCr = reportedMarketValueCr;
          stalePricedCount++;
        }
      } else if (h.isin && isUsListedEquityIsin(h.isin)) {
        // US-listed equity: priced via Finnhub (daily-cached, see foreign-pricing.ts)
        // + USD/INR conversion, independent of DHAN's health.
        const priceUsd = foreignPrices.get(h.isin);
        if (priceUsd !== undefined && usdInrRate !== null) {
          const priceInr = priceUsd * usdInrRate;
          priceSource = "foreign_live";
          livePriceInr = priceInr;
          liveMarketValueCr = (priceInr * Number(h.shares)) / CRORE;
          livePricedCount++;
        } else {
          priceSource = "stale_fallback";
          liveMarketValueCr = reportedMarketValueCr;
          stalePricedCount++;
        }
      } else {
        priceSource = "not_priceable";
        liveMarketValueCr = reportedMarketValueCr;
      }

      if (h.isin) {
        const isDebt = isDebtInstrument(h.sector, h.companyName);
        const isLive = priceSource === "live" || priceSource === "foreign_live";
        const existing = distinctIsinInfo.get(h.isin);
        distinctIsinInfo.set(h.isin, {
          isDebt: (existing?.isDebt ?? false) || isDebt,
          isLive: (existing?.isLive ?? false) || isLive,
        });
      }

      liveHoldingsSumCr += liveMarketValueCr;
      holdingViews.push({
        id: h.id,
        companyName: h.companyName,
        isin: h.isin,
        sector: h.sector,
        mcapClassification: h.mcapClassification,
        shares: Number(h.shares),
        weightPct: Number(h.weightPct ?? 0),
        reportedMarketValueCr,
        livePriceInr,
        liveMarketValueCr,
        priceSource,
      });
    }

    holdingsByAmcId.set(period.amcId, holdingViews);

    const residualPlugCr = Number(period.residualPlugCr);
    const reportedAumCr = Number(period.reportedAumCr);
    const liveAumCr = liveHoldingsSumCr + residualPlugCr;
    const deltaCr = liveAumCr - reportedAumCr;
    const deltaPct = reportedAumCr !== 0 ? deltaCr / reportedAumCr : 0;

    totalFailed += stalePricedCount;

    amcResults.push({
      amcId: period.amcId,
      slug: period.slug,
      overviewName: period.overviewName,
      reportPeriod,
      reportedAumCr,
      liveAumCr,
      deltaCr,
      deltaPct,
      residualPlugCr,
      holdingsCount: amcHoldingRows.length,
      debtInstrumentCount,
      livePricedCount,
      stalePricedCount,
      avgLiveAumCr: null,
      avgVsReportedPct: null,
      avgWindowDays: 0,
    });
  }

  // Based on holding-level outcomes, not requests.length — a holding can be
  // priceable-but-unpriced because its ISIN has no instrument_map entry yet
  // (needs a sync) even when zero DHAN requests were ever attempted, which
  // is just as much a "not working" state as a failed API call.
  let dhanStatus: DhanStatus;
  if (totalPriceable === 0) {
    dhanStatus = "ok";
  } else if (ltpResult.pricesBySecurityId.size === 0) {
    dhanStatus = "unavailable";
  } else if (ltpResult.failedSecurityIds.size > 0 || totalFailed > 0) {
    dhanStatus = "degraded";
  } else {
    dhanStatus = "ok";
  }

  let distinctDebtInstrumentCount = 0;
  let distinctLivePricedCount = 0;
  for (const info of distinctIsinInfo.values()) {
    if (info.isDebt) distinctDebtInstrumentCount++;
    if (info.isLive) distinctLivePricedCount++;
  }

  const snapshot: LiveAumSnapshot = {
    amcs: amcResults,
    totalLiveAumCr: amcResults.reduce((sum, a) => sum + a.liveAumCr, 0),
    totalReportedAumCr: amcResults.reduce((sum, a) => sum + a.reportedAumCr, 0),
    reportPeriod,
    computedAt: new Date().toISOString(),
    dhanStatus,
    distinctHoldingsCount: distinctIsinInfo.size,
    distinctDebtInstrumentCount,
    distinctLivePricedCount,
  };

  await writeDailySnapshot(snapshot);

  const averages = await getAverageAumSinceReport(reportPeriod).catch(() => new Map());
  for (const amc of amcResults) {
    const avg = averages.get(amc.amcId);
    if (avg) {
      amc.avgLiveAumCr = avg.avgLiveAumCr;
      amc.avgWindowDays = avg.daysCount;
      amc.avgVsReportedPct = amc.reportedAumCr !== 0 ? avg.avgLiveAumCr / amc.reportedAumCr - 1 : null;
    }
  }

  return { snapshot, holdingsByAmcId };
}

// Singleflight: dedupes concurrent cache-miss/forceRefresh callers within one
// warm serverless instance so they share one runComputation() (and therefore
// one DHAN LTP fetch cycle) instead of each independently bursting past
// DHAN's 1 req/sec limit. A forceRefresh caller intentionally joins an
// in-flight computation rather than starting a second one — it started at or
// after this call, so its result is fresh by definition. Does NOT dedupe
// across separate serverless instances (see cache.ts's upgrade-path comment);
// every current caller awaits this inside try/catch, so a rejection is always
// handled — a future fire-and-forget caller could trigger an unhandled
// rejection warning even when other joiners did handle it.
let inFlightComputation: Promise<ComputedLiveAum> | null = null;

async function getOrCompute(forceRefresh: boolean | undefined): Promise<ComputedLiveAum> {
  const reportPeriod = await getCurrentReportPeriod();

  if (!forceRefresh) {
    const cached = getCachedLiveAum(reportPeriod);
    if (cached) return cached;
  }

  if (inFlightComputation) return inFlightComputation;

  inFlightComputation = runComputation()
    .then((fresh) => {
      setCachedLiveAum(fresh, LIVE_AUM_CACHE_TTL_MS);
      return fresh;
    })
    .finally(() => {
      inFlightComputation = null;
    });

  return inFlightComputation;
}

export async function computeLiveAum(options?: { forceRefresh?: boolean }): Promise<LiveAumSnapshot> {
  const result = await getOrCompute(options?.forceRefresh);
  return result.snapshot;
}

export async function computeLiveAumForAmc(
  slug: string,
  options?: { forceRefresh?: boolean }
): Promise<{ amc: AmcLiveAum; holdings: HoldingLiveView[]; computedAt: string } | null> {
  const result = await getOrCompute(options?.forceRefresh);
  const amc = result.snapshot.amcs.find((a) => a.slug === slug);
  if (!amc) return null;
  const holdingViews = result.holdingsByAmcId.get(amc.amcId) ?? [];
  return { amc, holdings: holdingViews, computedAt: result.snapshot.computedAt };
}
