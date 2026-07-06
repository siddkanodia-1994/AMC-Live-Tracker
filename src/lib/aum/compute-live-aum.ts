import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, amcs, appSettings, holdings, instrumentMap, isinDailyPrice, liveAumDailySnapshot } from "../db/schema";
import { fetchLtps, segmentKey } from "../dhan/client";
import type { ExchangeSegment, LtpRequestItem } from "../dhan/types";
import { isBankDebtOrRepo, isCashEquivalent, isUsListedEquityIsin } from "../excel/instrument-classification";
import { getAllForeignPrices, getCachedUsdInrRate } from "./foreign-pricing";
import { CRORE, LIVE_AUM_CACHE_TTL_MS } from "../utils/constants";
import { getIstDateString } from "../utils/date";
import { isTradingDay, lastTradingDayIstString } from "../utils/market-hours";
import { getCachedLiveAum, setCachedLiveAum } from "./cache";
import { getAverageAumSinceReport, getNetFlowForPeriod, getPreviousDayIsinPrices, getPreviousDayLiveAum } from "./history";
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
          isCanonical: true,
          liveAumCr: String(amc.liveAumCr),
          reportedAumCr: String(amc.reportedAumCr),
          deltaCr: String(amc.deltaCr),
          deltaPct: String(amc.deltaPct),
        }))
      )
      // Overwrite (not onConflictDoNothing): today's row should track the
      // latest computation, not whichever one happened to run first. Without
      // this, an unlucky DHAN failure on the very first computation of the
      // day (e.g. a 429 right at market open) would permanently freeze that
      // day's chart point at the fallback-to-reported value, even though
      // every later computation that day succeeds normally. Past days are
      // untouched either way — a new snapshotDate starts a fresh row.
      // targetWhere matches this to the partial canonical index specifically
      // (the live cron always owns today's canonical row outright — a
      // comparison backfill can never reach today, see backfill.ts).
      .onConflictDoUpdate({
        target: [liveAumDailySnapshot.amcId, liveAumDailySnapshot.snapshotDate],
        targetWhere: sql`${liveAumDailySnapshot.isCanonical} = true`,
        set: {
          reportPeriod: sql`excluded.report_period`,
          liveAumCr: sql`excluded.live_aum_cr`,
          reportedAumCr: sql`excluded.reported_aum_cr`,
          deltaCr: sql`excluded.delta_cr`,
          deltaPct: sql`excluded.delta_pct`,
          computedAt: sql`now()`,
        },
      });
  } catch (err) {
    console.error("Failed to write daily live-AUM snapshot:", err);
  }
}

async function writeDailyIsinPrices(priceByIsin: Map<string, number>): Promise<void> {
  if (priceByIsin.size === 0) return;
  try {
    const today = getIstDateString();
    const rows = [...priceByIsin.entries()].map(([isin, priceInr]) => ({
      isin,
      snapshotDate: today,
      priceInr: String(priceInr),
    }));

    // Same overwrite-on-conflict reasoning as writeDailySnapshot: today's row
    // should track the latest computation, not freeze on the first one.
    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await db
        .insert(isinDailyPrice)
        .values(batch)
        .onConflictDoUpdate({
          target: [isinDailyPrice.isin, isinDailyPrice.snapshotDate],
          set: {
            priceInr: sql`excluded.price_inr`,
            computedAt: sql`now()`,
          },
        });
    }
  } catch (err) {
    console.error("Failed to write daily ISIN prices:", err);
  }
}

async function runComputation(): Promise<ComputedLiveAum> {
  const tradingDay = isTradingDay();
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

  // Don't even ask DHAN on a non-trading day — the market's closed, nothing
  // can have moved since the last close, and polling anyway is how this app
  // previously ended up rate-limited (429s) over a weekend for no benefit.
  const ltpResult = tradingDay
    ? await fetchLtps(requests)
    : { pricesBySecurityId: new Map<string, number>(), failedSecurityIds: new Set<string>() };
  const [foreignPrices, usdInrRate, previousIsinPrices] = await Promise.all([
    getAllForeignPrices().catch(() => new Map<string, number>()),
    getCachedUsdInrRate().catch(() => null),
    getPreviousDayIsinPrices().catch(() => new Map<string, number>()),
  ]);

  const holdingsByAmcId = new Map<number, HoldingLiveView[]>();
  const amcResults: AmcLiveAum[] = [];
  let totalFailed = 0;
  let totalPriceable = 0;

  // De-duplicated by ISIN across every AMC, for industry-wide totals — a
  // stock held by 50 of 56 AMCs is one distinct holding, not 50. Live-pricing
  // outcome is the same regardless of which AMC holds it, since pricing is
  // fetched once per ISIN and reused everywhere it appears (see priceableIsins
  // above), so "first write wins" here is never actually a conflict in practice.
  const distinctIsinInfo = new Map<string, { isLive: boolean }>();
  // Today's live price per ISIN, deduplicated the same way — written once to
  // isin_daily_price after the loop, seeding tomorrow's "1 Day Change" column.
  const todayPriceByIsin = new Map<string, number>();
  // Distinct debt/repo instruments industry-wide, matching each AMC page's
  // "Bank Debt & Repo" card classification (not just isDebtInstrument's
  // narrower G-Sec/dated-CD/CP set). Kept separate from distinctIsinInfo
  // because repo/cash line items (TREPS, Call Money, CBLO, ...) have no ISIN
  // and aren't shared securities across AMCs the way a stock ISIN is — each
  // AMC's own repo position is deduped by its (generic, shared) company name
  // instead, not folded into the ISIN-keyed "distinct holdings" count.
  const distinctDebtRepoKeys = new Set<string>();

  for (const period of periodRows) {
    const amcHoldingRows = holdingRows.filter((h) => h.amcId === period.amcId);
    const holdingViews: HoldingLiveView[] = [];
    let stalePricedCount = 0;
    let livePricedCount = 0;
    let debtInstrumentCount = 0;
    let liveHoldingsSumCr = 0;
    let cashEquivalentCr = 0;
    let bankDebtRepoCr = 0;
    // Same keying as distinctIsinInfo/distinctDebtRepoKeys below, scoped to
    // just this AMC -- lets the client union these across whatever subset of
    // AMCs is currently shown, instead of only ever seeing the fixed
    // industry-wide distinct counts.
    const amcHoldingIsins = new Set<string>();
    const amcDebtKeys = new Set<string>();
    const amcLivePricedIsins = new Set<string>();

    for (const h of amcHoldingRows) {
      const reportedMarketValueCr = Number(h.marketValueCr);
      let priceSource: PriceSource;
      let liveMarketValueCr: number;
      let livePriceInr: number | null = null;

      const isDebtOrRepo = isBankDebtOrRepo(h.sector, h.companyName);
      if (isDebtOrRepo) {
        debtInstrumentCount++;
        const debtKey = h.isin ?? h.companyName.trim().toLowerCase();
        distinctDebtRepoKeys.add(debtKey);
        amcDebtKeys.add(debtKey);
      }

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
          // DHAN didn't give us a live price for this one -- whether because
          // we didn't ask (non-trading day) or asked and failed (expired
          // token, rate limit, network error). Prefer the last known good
          // close over the stale reported value; only fall all the way back
          // to reportedMarketValueCr if this ISIN has never been priced.
          const lastKnownPrice = previousIsinPrices.get(h.isin);
          if (lastKnownPrice !== undefined) {
            priceSource = "last_close";
            livePriceInr = lastKnownPrice;
            liveMarketValueCr = (lastKnownPrice * Number(h.shares)) / CRORE;
            livePricedCount++;
          } else {
            priceSource = "stale_fallback";
            liveMarketValueCr = reportedMarketValueCr;
            stalePricedCount++;
          }
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

      if (isDebtOrRepo) bankDebtRepoCr += liveMarketValueCr;
      if (isCashEquivalent(h.companyName)) cashEquivalentCr += liveMarketValueCr;

      if (h.isin) {
        const isLive = priceSource === "live" || priceSource === "foreign_live" || priceSource === "last_close";
        amcHoldingIsins.add(h.isin);
        if (isLive) amcLivePricedIsins.add(h.isin);
        const existing = distinctIsinInfo.get(h.isin);
        distinctIsinInfo.set(h.isin, {
          isLive: (existing?.isLive ?? false) || isLive,
        });
        if (livePriceInr !== null) todayPriceByIsin.set(h.isin, livePriceInr);
      }

      const previousClosePriceInr = h.isin ? (previousIsinPrices.get(h.isin) ?? null) : null;
      const oneDayChangePct =
        livePriceInr !== null && previousClosePriceInr !== null && previousClosePriceInr !== 0
          ? (livePriceInr - previousClosePriceInr) / previousClosePriceInr
          : null;

      liveHoldingsSumCr += liveMarketValueCr;
      holdingViews.push({
        id: h.id,
        companyName: h.companyName,
        isin: h.isin,
        sector: h.sector,
        mcapClassification: h.mcapClassification,
        shares: Number(h.shares),
        weightPct: Number(h.weightPct ?? 0),
        previousClosePriceInr,
        oneDayChangePct,
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
      distinctHoldingIsins: [...amcHoldingIsins],
      distinctDebtKeys: [...amcDebtKeys],
      distinctLivePricedIsins: [...amcLivePricedIsins],
      cashEquivalentCr,
      bankDebtRepoCr,
      avgLiveAumCr: null,
      avgVsReportedPct: null,
      avgWindowDays: 0,
      previousDayLiveAumCr: null,
      oneDayChangePct: null,
      netFlowCr: null,
      netFlowPct: null,
      netFlowPriorPeriod: null,
      netFlowPriorPeriodReportedAumCr: null,
      netFlowBaselineCr: null,
    });
  }

  // Based on holding-level outcomes, not requests.length — a holding can be
  // priceable-but-unpriced because its ISIN has no instrument_map entry yet
  // (needs a sync) even when zero DHAN requests were ever attempted, which
  // is just as much a "not working" state as a failed API call.
  let dhanStatus: DhanStatus;
  if (!tradingDay) {
    // We deliberately didn't ask DHAN anything -- that's not a problem to
    // report, unlike a genuine failure on a trading day (handled below,
    // unchanged), which still needs to alert the admin to refresh the token.
    dhanStatus = "ok";
  } else if (totalPriceable === 0) {
    dhanStatus = "ok";
  } else if (ltpResult.pricesBySecurityId.size === 0) {
    dhanStatus = "unavailable";
  } else if (ltpResult.failedSecurityIds.size > 0 || totalFailed > 0) {
    dhanStatus = "degraded";
  } else {
    dhanStatus = "ok";
  }

  const distinctDebtInstrumentCount = distinctDebtRepoKeys.size;
  let distinctLivePricedCount = 0;
  for (const info of distinctIsinInfo.values()) {
    if (info.isLive) distinctLivePricedCount++;
  }

  const snapshot: LiveAumSnapshot = {
    amcs: amcResults,
    totalLiveAumCr: amcResults.reduce((sum, a) => sum + a.liveAumCr, 0),
    totalReportedAumCr: amcResults.reduce((sum, a) => sum + a.reportedAumCr, 0),
    reportPeriod,
    computedAt: new Date().toISOString(),
    dhanStatus,
    dhanErrorDetail: ltpResult.apiError ?? null,
    distinctHoldingsCount: distinctIsinInfo.size,
    distinctDebtInstrumentCount,
    distinctLivePricedCount,
    priceAsOfDate: tradingDay ? getIstDateString() : lastTradingDayIstString(),
    pricesAreLive: tradingDay,
  };

  // Skip persisting on non-trading days (weekend/holiday) — the computation
  // above still runs and is still returned/cached so visitors see a live-ish
  // figure (naturally held over from the last trading day's prices), it just
  // doesn't get written as a new dated row. Without this, both the cron
  // (which fires daily regardless of weekday) and any live page/API visit
  // (force-dynamic pages re-run this on every cache miss) would otherwise
  // write a spurious snapshot for Saturdays/Sundays/holidays.
  if (tradingDay) {
    await Promise.all([writeDailySnapshot(snapshot), writeDailyIsinPrices(todayPriceByIsin)]);
  }

  const [averages, previousDay, netFlows] = await Promise.all([
    getAverageAumSinceReport(reportPeriod).catch(() => new Map()),
    getPreviousDayLiveAum().catch(() => new Map()),
    getNetFlowForPeriod(reportPeriod).catch(() => new Map()),
  ]);
  for (const amc of amcResults) {
    const avg = averages.get(amc.amcId);
    if (avg) {
      amc.avgLiveAumCr = avg.avgLiveAumCr;
      amc.avgWindowDays = avg.daysCount;
      amc.avgVsReportedPct = amc.reportedAumCr !== 0 ? avg.avgLiveAumCr / amc.reportedAumCr - 1 : null;
    }

    const prev = previousDay.get(amc.amcId);
    if (prev) {
      if (tradingDay) {
        amc.previousDayLiveAumCr = prev.liveAumCr;
        amc.oneDayChangePct = prev.liveAumCr !== 0 ? (amc.liveAumCr - prev.liveAumCr) / prev.liveAumCr : null;
      } else {
        // Frozen day: today's figure is definitionally a repeat of the last
        // trading day's. Force a clean 0% rather than trust this run's
        // recomputed liveAumCr to exactly match the persisted prior-day row
        // — it won't, if any one holding was individually stale_fallback
        // specifically on that prior day (previousIsinPrices would then skip
        // past it to an even earlier price for that ISIN, while every other
        // holding here correctly uses the prior day's), which would produce
        // a spurious tiny nonzero "change" on a day nothing actually moved.
        amc.previousDayLiveAumCr = amc.liveAumCr;
        amc.oneDayChangePct = 0;
      }
    }

    const netFlow = netFlows.get(amc.amcId);
    if (netFlow) {
      amc.netFlowCr = netFlow.netFlowCr;
      amc.netFlowPct = netFlow.netFlowPct;
      amc.netFlowPriorPeriod = netFlow.priorPeriod;
      amc.netFlowPriorPeriodReportedAumCr = netFlow.priorPeriodReportedAumCr;
      amc.netFlowBaselineCr = netFlow.baselineCr;
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
): Promise<{
  amc: AmcLiveAum;
  holdings: HoldingLiveView[];
  computedAt: string;
  priceAsOfDate: string;
  pricesAreLive: boolean;
} | null> {
  const result = await getOrCompute(options?.forceRefresh);
  const amc = result.snapshot.amcs.find((a) => a.slug === slug);
  if (!amc) return null;
  const holdingViews = result.holdingsByAmcId.get(amc.amcId) ?? [];
  return {
    amc,
    holdings: holdingViews,
    computedAt: result.snapshot.computedAt,
    priceAsOfDate: result.snapshot.priceAsOfDate,
    pricesAreLive: result.snapshot.pricesAreLive,
  };
}
