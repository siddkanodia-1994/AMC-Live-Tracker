import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { amcs, holdings, isinDailyPrice, liveAumDailySnapshot } from "../db/schema";
import { isBankDebtOrRepo, isCashEquivalent } from "../excel/instrument-classification";
import { CRORE } from "../utils/constants";
import { getCanonicalSnapshotDateBounds } from "./history";
import { getActiveShareMultipliers, type ShareAdjustment } from "./share-adjustments";
import type { AmcLiveAum, HoldingLiveView } from "./types";

/**
 * One AMC's holdings reconstructed as they stood/priced on an arbitrary past
 * trading date -- the per-holding sibling of computeOverviewAsOf (which only
 * has AMC-level totals, not a holdings breakdown). Built from data that
 * already exists: `holdings` (static per report period) joined with
 * `isin_daily_price` (per-ISIN daily closes) for the selected date and its
 * preceding trading day. Mirrors computeLiveAumForAmc's return shape so the
 * client barely needs to branch between live and historical responses.
 */
export async function computeAmcAsOf(
  slug: string,
  requestedDate: string
): Promise<{
  amc: AmcLiveAum;
  holdings: HoldingLiveView[];
  computedAt: string;
  priceAsOfDate: string;
  pricesAreLive: boolean;
  asOfDate: string;
  minSnapshotDate: string | null;
  maxSnapshotDate: string | null;
} | null> {
  const [amcRow] = await db.select().from(amcs).where(eq(amcs.slug, slug));
  if (!amcRow) return null;

  const { minDate, maxDate } = await getCanonicalSnapshotDateBounds();
  const asOfDate = !minDate || !maxDate ? requestedDate : requestedDate < minDate ? minDate : requestedDate > maxDate ? maxDate : requestedDate;

  // This AMC's canonical reportPeriod on or before the date -- the same "on
  // or before" tolerance getAllAmcsLiveAumAsOf uses, just scoped to one AMC
  // so a plain ORDER BY + LIMIT 1 is enough (no window function needed).
  const [canonicalRow] = await db
    .select({ reportPeriod: liveAumDailySnapshot.reportPeriod, reportedAumCr: liveAumDailySnapshot.reportedAumCr })
    .from(liveAumDailySnapshot)
    .where(
      and(
        eq(liveAumDailySnapshot.amcId, amcRow.id),
        lte(liveAumDailySnapshot.snapshotDate, asOfDate),
        eq(liveAumDailySnapshot.isCanonical, true)
      )
    )
    .orderBy(desc(liveAumDailySnapshot.snapshotDate))
    .limit(1);
  if (!canonicalRow) return null;
  const reportPeriod = canonicalRow.reportPeriod;

  const holdingRows = await db.select().from(holdings).where(and(eq(holdings.amcId, amcRow.id), eq(holdings.reportPeriod, reportPeriod)));

  const priceableIsins = [...new Set(holdingRows.filter((h) => h.isPriceable && h.isin).map((h) => h.isin as string))];

  // Top-2 most recent isin_daily_price rows per ISIN on or before the date
  // (today's close + the prior trading day's) in one query -- same
  // row_number()-partition pattern overview-as-of.ts already uses for
  // per-AMC snapshots, applied per-ISIN instead.
  const priceRowsByIsin = new Map<string, { snapshotDate: string; priceInr: number }[]>();
  if (priceableIsins.length > 0) {
    const ranked = db.$with("ranked_prices").as(
      db
        .select({
          isin: isinDailyPrice.isin,
          snapshotDate: isinDailyPrice.snapshotDate,
          priceInr: isinDailyPrice.priceInr,
          rn: sql<number>`row_number() over (partition by ${isinDailyPrice.isin} order by ${isinDailyPrice.snapshotDate} desc)`.as("rn"),
        })
        .from(isinDailyPrice)
        .where(and(inArray(isinDailyPrice.isin, priceableIsins), lte(isinDailyPrice.snapshotDate, asOfDate)))
    );
    const priceRows = await db
      .with(ranked)
      .select()
      .from(ranked)
      .where(sql`${ranked.rn} <= 2`)
      .orderBy(ranked.isin, desc(ranked.snapshotDate));
    for (const r of priceRows) {
      const list = priceRowsByIsin.get(r.isin);
      const entry = { snapshotDate: r.snapshotDate, priceInr: Number(r.priceInr) };
      if (list) list.push(entry);
      else priceRowsByIsin.set(r.isin, [entry]);
    }
  }

  // Auto-detected split/bonus corrections active for this reportPeriod (see
  // split-detection.ts) -- a dismissed "not a real split" is already
  // excluded here (getActiveShareMultipliers filters dismissedAt IS NULL),
  // so it correctly never applies, historical or live. Unlike the live path
  // (always "today", always after any detected split), whether this applies
  // to a given holding here further depends on which date is being viewed --
  // resolved per-holding below by comparing the actual priced dates against
  // adj.firstDetectedOn, not by pre-filtering this query on asOfDate.
  const shareAdjustmentsByIsin = await getActiveShareMultipliers(reportPeriod).catch(() => new Map<string, ShareAdjustment>());

  const holdingViews: HoldingLiveView[] = [];
  let cashEquivalentCr = 0;
  let bankDebtRepoCr = 0;
  let debtInstrumentCount = 0;
  let livePricedCount = 0;
  let stalePricedCount = 0;
  const distinctHoldingIsins = new Set<string>();
  const distinctDebtKeys = new Set<string>();
  const distinctLivePricedIsins = new Set<string>();
  let liveWithPrevDaySumCr = 0;
  let previousDaySumCr = 0;

  for (const h of holdingRows) {
    const reportedMarketValueCr = Number(h.marketValueCr);
    const isDebtOrRepo = isBankDebtOrRepo(h.sector, h.companyName);
    if (isDebtOrRepo) {
      debtInstrumentCount++;
      distinctDebtKeys.add(h.isin ?? h.companyName.trim().toLowerCase());
    }

    let livePriceInr: number | null = null;
    let previousClosePriceInr: number | null = null;
    let liveMarketValueCr = reportedMarketValueCr;
    let oneDayChangePct: number | null = null;
    let oneDayChangeCr: number | null = null;
    // Populated only when the split had already happened as of the priced
    // date shown (latestIsPostSplit below) -- so the badge (which keys off
    // this being non-null) only appears for dates it actually applies to.
    let shareAdjustment: HoldingLiveView["shareAdjustment"] = null;

    const adj = h.isin ? shareAdjustmentsByIsin.get(h.isin) : undefined;

    if (h.isin && h.isPriceable) {
      const prices = priceRowsByIsin.get(h.isin) ?? [];
      const [latest, prior] = prices; // newest-first
      // Whether the split had already happened as of each priced date --
      // derived from the actual price rows' own dates (more robust than the
      // outer asOfDate against any data gaps), not whether an adjustment
      // merely exists. Browsing to a date before the split shows the
      // original, genuinely-true-then shares; on/after shows the adjusted
      // figure.
      const latestIsPostSplit = !!(adj && latest && latest.snapshotDate >= adj.firstDetectedOn);
      const priorIsPostSplit = !!(adj && prior && prior.snapshotDate >= adj.firstDetectedOn);
      const effectiveShares = latestIsPostSplit ? Number(h.shares) * adj!.multiplier : Number(h.shares);

      if (latest) {
        livePriceInr = latest.priceInr;
        liveMarketValueCr = (latest.priceInr * effectiveShares) / CRORE;
        livePricedCount++;
        distinctLivePricedIsins.add(h.isin);
        if (latestIsPostSplit) {
          shareAdjustment = {
            multiplier: adj!.multiplier,
            firstDetectedOn: adj!.firstDetectedOn,
            lastPriceBeforeInr: adj!.lastPriceBeforeInr,
            lastPriceAfterInr: adj!.lastPriceAfterInr,
          };
        }
      } else {
        stalePricedCount++;
      }
      if (prior) previousClosePriceInr = prior.priceInr;

      // The two compared prices straddle the split (one pre-, one post-) --
      // can't meaningfully compare, same "null for incomparable" treatment
      // as the live path's own boundary-day fix. Only when both sides agree
      // (both pre- or both post-split) is a 1-day comparison computed,
      // using effectiveShares consistently on both sides.
      if (latestIsPostSplit === priorIsPostSplit && livePriceInr !== null && previousClosePriceInr !== null) {
        oneDayChangePct = previousClosePriceInr !== 0 ? (livePriceInr - previousClosePriceInr) / previousClosePriceInr : null;
        oneDayChangeCr = ((livePriceInr - previousClosePriceInr) * effectiveShares) / CRORE;
      }
    }

    if (isDebtOrRepo) bankDebtRepoCr += liveMarketValueCr;
    if (isCashEquivalent(h.companyName)) cashEquivalentCr += liveMarketValueCr;
    if (h.isin) distinctHoldingIsins.add(h.isin);
    if (oneDayChangeCr !== null) {
      liveWithPrevDaySumCr += liveMarketValueCr;
      previousDaySumCr += liveMarketValueCr - oneDayChangeCr;
    }

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
      oneDayChangeCr,
      reportedMarketValueCr,
      livePriceInr,
      liveMarketValueCr,
      // Every row here is a stored historical close, not a today-only
      // live/foreign/stale distinction -- labeled uniformly, matching how
      // computeOverviewAsOf simplifies its own AMC-level equivalent.
      priceSource: livePriceInr !== null ? "last_close" : "stale_fallback",
      shareAdjustment,
    });
  }

  const reportedAumCr = Number(canonicalRow.reportedAumCr);
  const liveAumCr = holdingViews.reduce((sum, h) => sum + h.liveMarketValueCr, 0);
  const previousDayLiveAumCr = previousDaySumCr > 0 ? previousDaySumCr : null;
  const amcOneDayChangePct = previousDayLiveAumCr !== null && previousDayLiveAumCr !== 0 ? liveWithPrevDaySumCr / previousDayLiveAumCr - 1 : null;

  const amc: AmcLiveAum = {
    amcId: amcRow.id,
    slug: amcRow.slug,
    overviewName: amcRow.overviewName,
    reportPeriod,
    reportedAumCr,
    liveAumCr,
    deltaCr: liveAumCr - reportedAumCr,
    deltaPct: reportedAumCr !== 0 ? liveAumCr / reportedAumCr - 1 : 0,
    residualPlugCr: 0,
    holdingsCount: holdingRows.length,
    debtInstrumentCount,
    livePricedCount,
    stalePricedCount,
    distinctHoldingIsins: [...distinctHoldingIsins],
    distinctDebtKeys: [...distinctDebtKeys],
    distinctLivePricedIsins: [...distinctLivePricedIsins],
    cashEquivalentCr,
    bankDebtRepoCr,
    // Report-period-window concepts (avg AUM windows, net flow), not
    // date-specific -- kept null in historical mode, same simplification
    // computeOverviewAsOf already makes for its own AMC-level equivalent.
    avgLiveAumCr: null,
    avgVsReportedPct: null,
    avgWindowDays: 0,
    avgLiveAumCr90d: null,
    avgLiveAumCrPrev90d: null,
    previousDayLiveAumCr,
    oneDayChangePct: amcOneDayChangePct,
    netFlowCr: null,
    netFlowPct: null,
    netFlowPriorPeriod: null,
    netFlowPriorPeriodReportedAumCr: null,
    netFlowBaselineCr: null,
  };

  return {
    amc,
    holdings: holdingViews,
    computedAt: new Date().toISOString(),
    priceAsOfDate: asOfDate,
    pricesAreLive: false,
    asOfDate,
    minSnapshotDate: minDate,
    maxSnapshotDate: maxDate,
  };
}
