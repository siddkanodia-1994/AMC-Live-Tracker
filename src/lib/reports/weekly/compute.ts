// The weekly report's figures, computed with the AMC Analytics tab's own
// maths and saved settings from its GET payloads (no DB access), so every
// number equals what the tab shows for the same day.

import accordCodesJson from "../../../../data/amc-accord-codes.json";
import type { AmcStockCorrelationEntry } from "../../amc-stock/correlation-summary";
import { savedFitView, type SavedFitView } from "../../amc-stock/fit-section-inputs";
import { computeFitCorrelation } from "../../amc-stock/fit-stats";
import { LISTED_AMC_TABS } from "../../amc-stock/listed-amc-tabs";
import { computePctChangeRegression } from "../../amc-stock/pct-change-regression";
import { computeRegressionResult, type ExtraLagDays } from "../../amc-stock/regression-engine";
import { computeRangeCutoffDate, filterByCutoff } from "../../aum/date-range";
import { buildPeriodLedger, ledgerChange, type PeriodLedger } from "../../aum/period-ledger";
import { toLedgerPoints } from "../../aum/period-ledger-rows";
import { buildIndustrySipSeries, meanSdPopulation } from "../../aum/industry-sip";
import { getFiscalQuarterBounds, getPreviousFiscalQuarterBounds } from "../../aum/report-period";
import { addDaysToDateString } from "../../utils/date";
import { isTradingDay } from "../../utils/market-hours";
import { computeBands, VALUATION_BAND_DEFAULT_RANGE } from "../../valuation/bands";
import { computeRatioLadder, RATIO_LADDER_SDS } from "../../valuation/ratio-ladder";
import { computeTargetPrices, SCENARIO_KEYS, type ValuationMethodKey } from "../../valuation/target-price";
import { buildTargetPriceInputs, resolveValuationSettings } from "../../valuation/target-price-inputs";
import { estimateFor, manualForTargetYear } from "../../valuation/target-year";
import { nextWeekCalendar } from "./next-week";
import type { AmcWeekly, Bands, RawReportInputs, WeeklyReportData, Win } from "./types";

const COMPANY_BY_SLUG = new Map(Object.values(accordCodesJson as Record<string, { slug: string; company: string }>).map((v) => [v.slug, v.company]));
const NIPPON = "nippon-india-mutual-fund";
const METHODS: ValuationMethodKey[] = ["ratio", "bestFit", "pe", "mcapSales"];

const finite = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);
const chg = (a: number | null | undefined, b: number | null | undefined) => finite(ledgerChange(finite(a), finite(b)));

export function isTradingDate(date: string): boolean {
  // Midday IST, so the IST calendar day is the date itself.
  return isTradingDay(new Date(`${date}T06:30:00Z`));
}

/** The last trading day on or before `date`. */
export function lastTradingDateOnOrBefore(date: string): string {
  let d = date;
  for (let i = 0; i < 15 && !isTradingDate(d); i++) d = addDaysToDateString(d, -1);
  return d;
}

/** Trading days strictly after `from` up to and including `to`. */
export function tradingDaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = addDaysToDateString(from, 1); d <= to; d = addDaysToDateString(d, 1)) if (isTradingDate(d)) n++;
  return n;
}

function win(ledger: PeriodLedger, kind: "q" | "m", label: string | null | undefined): Win {
  const w = ledger.period(kind, label);
  return { label: label ?? "", value: finite(w.value), days: w.days };
}

function closeOnOrBefore(series: { date: string; priceInr: number }[], date: string): { date: string; priceInr: number } | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i].date <= date) return series[i];
  return null;
}

/** "FY 2027 November" → "FY 2026 November". */
function sameMonthLastYear(label: string, months: string[]): string | null {
  const m = /^FY (\d{4}) (.+)$/.exec(label);
  if (!m) return null;
  const want = `FY ${Number(m[1]) - 1} ${m[2]}`;
  return months.includes(want) ? want : null;
}

function sipQuarterKey(fy: number, q: number, back: number): { key: string; label: string } {
  let f = fy;
  let qq = q - back;
  while (qq < 1) {
    qq += 4;
    f -= 1;
  }
  return { key: `${f}-${qq}`, label: `Q${qq} FY${String(f).slice(2)}` };
}

/** Lowest and highest point of a base-100 index, with their dates. */
function indexExtremes(rows: { date: string; value: number }[]): { low: { date: string; value: number } | null; high: { date: string; value: number } | null } {
  if (!rows.length) return { low: null, high: null };
  let low = rows[0];
  let high = rows[0];
  for (const r of rows) {
    if (r.value < low.value) low = r;
    if (r.value > high.value) high = r;
  }
  return { low, high };
}

/** From the last row on or before `baseDate` onward (the index base and everything after). */
function fromBase<T extends { date: string }>(rows: T[], baseDate: string): T[] {
  let i = -1;
  for (let k = rows.length - 1; k >= 0; k--) {
    if (rows[k].date <= baseDate) {
      i = k;
      break;
    }
  }
  return i < 0 ? [] : rows.slice(i);
}

function upTo<T extends { date: string }>(rows: T[], asOf: string): T[] {
  return rows.filter((r) => r.date <= asOf);
}

/** The Industry SIP graph's 3Y range in YoY % mode (industry-sip-view.tsx). */
const SIP_YOY_MONTHS = 36;

export function industrySipYoy(flows: RawReportInputs["flows"], asOf: string, months: number): WeeklyReportData["industry"]["sipYoy"] {
  const known = flows.flatMap((f) => (f.monthEndDate <= asOf && f.sipContributionsCr != null ? [{ monthEndDate: f.monthEndDate, sipContributionsCr: f.sipContributionsCr }] : []));
  const shown = buildIndustrySipSeries(known).slice(-months);
  const points = shown.flatMap((p) => (p.yoyPct === null ? [] : [{ month: p.key, yoy: p.yoyPct }]));
  if (!points.length) return null;
  const stats = meanSdPopulation(points.map((p) => p.yoy));
  const current = points.at(-1)!;
  return {
    months: shown.length,
    points,
    mean: stats?.mean ?? null,
    sd: stats?.sd ?? null,
    current: current.yoy,
    currentMonth: current.month,
    z: stats && stats.sd !== 0 ? (current.yoy - stats.mean) / stats.sd : null,
  };
}

export const ALERT_Z = 2;
export const ALERT_SHARE_BPS = 10;

/** Threshold events for takeaway slot 7: closes beyond the weighted Bear / Bull, |Z| ≥ 2, share moves ≥ 10 bps. */
export function weeklyAlerts(amcs: AmcWeekly[], sipZ: number | null): WeeklyReportData["alerts"] {
  const out: WeeklyReportData["alerts"] = [];
  for (const a of amcs) {
    const close = a.price.close;
    const t = a.targets.average;
    // Without a PAT estimate the target rests on Ratio + Best fit only: not comparable, so no target alerts.
    const targetsComparable = !a.targets.noPat;
    if (targetsComparable && close != null && t.bear != null && close < t.bear) out.push({ kind: "below-bear", amc: a.short, text: `${a.short} closed below its weighted Bear target`, ref: `amcs.${a.short}.targets.average.bear` });
    if (targetsComparable && close != null && t.bull != null && close > t.bull) out.push({ kind: "above-bull", amc: a.short, text: `${a.short} closed above its weighted Bull target`, ref: `amcs.${a.short}.targets.average.bull` });
    if (a.earnings.peZ != null && Math.abs(a.earnings.peZ) >= ALERT_Z) out.push({ kind: "pe-z", amc: a.short, text: `${a.short}'s PE is beyond ±${ALERT_Z} SD of its mean`, ref: `amcs.${a.short}.earnings.peZ` });
    if (a.share.qoqBps != null && Math.abs(a.share.qoqBps) >= ALERT_SHARE_BPS) out.push({ kind: "share-move", amc: a.short, text: `${a.short}'s share moved ${ALERT_SHARE_BPS} bps or more QoQ`, ref: `amcs.${a.short}.share.qoqBps` });
  }
  if (sipZ != null && Math.abs(sipZ) >= ALERT_Z) out.push({ kind: "sip-z", amc: null, text: `Industry SIP YoY is beyond ±${ALERT_Z}σ of its 3Y mean`, ref: "industry.sipYoy.z" });
  return out;
}

export function buildWeeklyReportData(raw: RawReportInputs, requestedAsOf: string, generatedAt: string): WeeklyReportData {
  const warnings: string[] = [];
  const asOf = lastTradingDateOnOrBefore(requestedAsOf);
  const defaults = raw.correlations.defaults;
  const fitView: SavedFitView = savedFitView(defaults);
  const settings = resolveValuationSettings(defaults);
  const q = getFiscalQuarterBounds(asOf);
  const prevQ = getPreviousFiscalQuarterBounds(asOf);
  const sessionsLeft = tradingDaysBetween(asOf, q.end);

  // Industry equity AUM: the dashboard's "Industry Total" row.
  const rangeUpTo = upTo(raw.industryRange, asOf);
  const seriesOf = (name: string) => rangeUpTo.filter((r) => r.amcName === name && (r.liveAumCr ?? 0) > 0).map((r) => ({ date: r.date, liveAumCr: r.liveAumCr! }));
  const ind = buildPeriodLedger(toLedgerPoints(seriesOf("Industry Total")));
  const indDefaults = ind.defaults();
  const [iqCur, iqPrev, , iqYoy] = indDefaults.q;
  const indQuarters = ind.quarters.slice(-6).map((l) => win(ind, "q", l));
  const indCur = win(ind, "q", iqCur);
  const indPrev = win(ind, "q", iqPrev);
  const indMCur = win(ind, "m", indDefaults.m[0]);
  const indMPrev = win(ind, "m", indDefaults.m[1]);
  const indQoq = chg(indCur.value, indPrev.value);
  const indDaily = fromBase(seriesOf("Industry Total"), prevQ.end);
  const indProjected = indCur.value != null && indMCur.value != null ? (indCur.value * indCur.days + indMCur.value * sessionsLeft) / (indCur.days + sessionsLeft) : null;

  // The latest quarter any AMC has a SIP figure for (an AMC's card anchor can run ahead of its data).
  const sipAnchor = raw.sipQuarterly
    .flatMap((a) => Object.entries(a.quarters).filter(([, c]) => c?.sipCr != null).map(([k]) => k.split("-").map(Number) as [number, number]))
    .reduce<{ fy: number; q: number } | null>((best, [fy, q]) => (!best || fy > best.fy || (fy === best.fy && q > best.q) ? { fy, q } : best), null);

  const amcs: AmcWeekly[] = [];
  let qLabels: { cur: string; prev: string; yoy: string; mCur: string; mPrev: string; sessions: number } | null = null;

  for (const tab of LISTED_AMC_TABS) {
    const full = raw.correlations.amcs.find((a) => a.slug === tab.slug);
    const per = raw.perAmc[tab.slug];
    if (!full || !per) {
      warnings.push(`${tab.tab}: no data in the AMC Analytics payloads`);
      continue;
    }
    // Everything as of the report date (a later run never leaks newer days in).
    const entry: AmcStockCorrelationEntry = { ...full, aumHistory: upTo(full.aumHistory, asOf), stockPriceSeries: upTo(full.stockPriceSeries, asOf) };
    const prices = entry.stockPriceSeries;
    const overviewName = raw.listed.find((l) => l.slug === tab.slug)?.overviewName ?? full.overviewName;

    // ── AUM run-rate (the AUM Summary ledger) ──
    const ledger = buildPeriodLedger(toLedgerPoints(entry.aumHistory));
    const d = ledger.defaults();
    const [lqCur, lqPrev, , lqYoy] = d.q;
    const qCur = win(ledger, "q", lqCur);
    const qPrev = win(ledger, "q", lqPrev);
    const qYoy = win(ledger, "q", lqYoy);
    const mCur = win(ledger, "m", d.m[0]);
    const mPrev = win(ledger, "m", d.m[1]);
    const mYoyLabel = sameMonthLastYear(d.m[0], ledger.months);
    const mYoy = mYoyLabel ? win(ledger, "m", mYoyLabel) : null;
    if (!qLabels) qLabels = { cur: lqCur, prev: lqPrev, yoy: lqYoy, mCur: d.m[0], mPrev: d.m[1], sessions: qCur.days };
    const last5 = finite(ledger.tail(5).value);
    const prev5 = finite(ledger.tailPrev(5).value);
    const last45 = finite(ledger.tail(45).value);
    const projected = qCur.value != null && mCur.value != null ? (qCur.value * qCur.days + mCur.value * sessionsLeft) / (qCur.days + sessionsLeft) : null;

    // ── Market share (equity only, Nippon too) ──
    const eq = buildPeriodLedger(toLedgerPoints(seriesOf(overviewName)));
    const shareQuarters = indQuarters
      .map((iq) => {
        const a = eq.period("q", iq.label).value;
        return a && iq.value ? { label: iq.label, share: a / iq.value } : null;
      })
      .filter((x): x is { label: string; share: number } => x !== null)
      .slice(-4);
    const eqLast5 = eq.tail(5).value;
    const indLast5 = ind.tail(5).value;
    const eqQoq = chg(eq.period("q", iqCur).value, eq.period("q", iqPrev).value);

    // ── SIP & Score ──
    const sipRow = raw.sipQuarterly.find((s) => s.slug === tab.slug);
    const sip =
      sipRow && sipAnchor
        ? (() => {
            const qs = [4, 3, 2, 1, 0].map((back) => {
              const k = sipQuarterKey(sipAnchor.fy, sipAnchor.q, back);
              const cell = sipRow.quarters[k.key];
              return { ...k, sipCr: finite(cell?.sipCr), sipEqAumPct: finite(cell?.sipEqAumPct) };
            });
            return { quarters: qs, qoq: chg(qs[4].sipCr, qs[3].sipCr), yoy: chg(qs[4].sipCr, qs[0].sipCr) };
          })()
        : null;
    const card = per.score.card;
    const yearAgo = card?.rows.find((r) => r.label.startsWith("1 Year Ago"));
    const score = card ? { latest: finite(card.rows[0]?.score), latestLabel: card.rows[0]?.label ?? null, vs1yAgo: finite(yearAgo?.changePct) } : null;

    // ── Share price ──
    const last = prices.at(-1) ?? null;
    const weekAgo = closeOnOrBefore(prices, addDaysToDateString(asOf, -7));
    const qStart = closeOnOrBefore(prices, prevQ.end);
    const cmp = last?.priceInr ?? null;
    // AUM and price both indexed to the previous quarter's last session, so their changes compare.
    const aumDaily = fromBase(entry.aumHistory, prevQ.end).map((p) => ({ date: p.date, value: p.liveAumCr }));
    const aumBase = aumDaily[0]?.value;
    const aumSinceQs = aumBase && aumDaily.length > 1 ? chg(aumDaily.at(-1)!.value, aumBase) : null;
    const aumExt = indexExtremes(aumBase ? aumDaily.slice(1).map((p) => ({ date: p.date, value: (p.value / aumBase) * 100 })) : []);
    const priceIndexed = qStart ? prices.filter((p) => p.date >= qStart.date).map((p) => ({ date: p.date, value: (p.priceInr / qStart.priceInr) * 100 })) : [];
    const priceSinceQs = chg(cmp, qStart?.priceInr);
    const priceExt = indexExtremes(priceIndexed.slice(1));

    // ── Ratio ladder (Ratio section, saved fit view) ──
    const ladder = computeRatioLadder(entry.aumHistory, prices, { maDays: fitView.maDays, range: fitView.range, aumOnlyAveraging: fitView.aumOnlyAveraging });
    const fit = computeFitCorrelation(entry.aumHistory, prices, { ...fitView, extraLagDays: defaults.extraLagDays });
    const ratio = ladder
      ? {
          levels: RATIO_LADDER_SDS.map((k) => {
            const r = ladder.meanRatio + k * ladder.stdDev;
            const price = r * ladder.aumCr;
            return { sd: k, ratio: r, price, vsPrice: cmp ? price / cmp - 1 : null };
          }),
          zScore: finite(ladder.zScore),
          fairValue: ladder.meanRatio * ladder.aumCr,
          meanVsPrice: cmp ? (ladder.meanRatio * ladder.aumCr) / cmp - 1 : null,
          gap: cmp ? (cmp - ladder.meanRatio * ladder.aumCr) / (ladder.meanRatio * ladder.aumCr) : null,
          corr: finite(fit?.r),
          r2: finite(fit?.r2),
          sessions: ladder.n,
        }
      : null;

    // ── Regression (Regression section, saved fit view) ──
    const fitConfig = { maWindow: fitView.maDays, extraLagDays: defaults.extraLagDays as ExtraLagDays, range: fitView.range };
    let regression: AmcWeekly["regression"] = null;
    if (fitView.levelsCorrelation) {
      const r = computeRegressionResult(entry.aumHistory, prices, fitConfig);
      if (r) regression = { model: "levels", target: r.fairValueAtLatest, vsPrice: cmp ? r.fairValueAtLatest / cmp - 1 : null, corr: finite(r.pearsonR), r2: finite(r.r2) };
    } else {
      const r = computePctChangeRegression(entry.aumHistory, prices, fitConfig);
      if (r) regression = { model: "pct-change", target: finite(r.target?.targetPrice), vsPrice: r.target && cmp ? r.target.targetPrice / cmp - 1 : null, corr: finite(r.pearsonR), r2: finite(r.r2) };
    }

    // ── Earnings & PE (Valuation Model inputs and PE series) ──
    const manualAll = per.inputs.manual;
    const pat: Record<number, number | null> = {};
    for (let fy = 2026; fy <= Math.max(raw.targetFy, 2028); fy++) pat[fy] = finite(estimateFor(manualAll, per.inputs.estimates, "pat", fy));
    const shares = finite(manualAll.noOfSharesCr);
    const pts = upTo(per.valuation.points, asOf);
    // The PE band chart's own window (its default Valuation range) and bands (valuation-band-charts.tsx).
    const peRows = pts.flatMap((p) => (p.pe === null ? [] : [{ date: p.date, value: p.pe }]));
    const peBands = computeBands(filterByCutoff(peRows, computeRangeCutoffDate(peRows, VALUATION_BAND_DEFAULT_RANGE)).map((r) => r.value));
    const peNow = finite(peRows.at(-1)?.value);

    // ── Target prices (Valuation Model's table) ──
    const table = computeTargetPrices(
      buildTargetPriceInputs({
        entry,
        defaults,
        settings,
        manual: manualForTargetYear(manualAll, per.inputs.estimates, raw.targetFy),
        valuationPoints: pts,
        cmpInr: cmp,
      })
    );
    const bands = (s: Bands): Bands => ({ bear: finite(s.bear), base: finite(s.base), bull: finite(s.bull) });
    const methods = Object.fromEntries(
      METHODS.map((k) => [k, { ...bands(table.methods[k]), upside: finite(table.upside[k].base), share: finite(table.averageShares[k]) }])
    ) as AmcWeekly["targets"]["methods"];
    const noPat = pat[raw.targetFy] == null;
    if (noPat) warnings.push(`${tab.tab}: no FY${String(raw.targetFy).slice(2)}E PAT saved, so PE and Mcap/Sales drop out of its target`);
    for (const k of SCENARIO_KEYS) if (table.average[k] == null) warnings.push(`${tab.tab}: no ${k} target`);

    amcs.push({
      slug: tab.slug,
      short: tab.tab,
      company: COMPANY_BY_SLUG.get(tab.slug) ?? overviewName,
      tradingSymbol: full.tradingSymbol,
      blended: tab.slug === NIPPON,
      aum: {
        qCur,
        qPrev,
        qYoy,
        mCur,
        mPrev,
        mYoy,
        qoq: chg(qCur.value, qPrev.value),
        yoy: chg(qCur.value, qYoy.value),
        mom: chg(mCur.value, mPrev.value),
        mYoyChg: mYoy ? chg(mCur.value, mYoy.value) : null,
        quarterly: ledger.quarters.slice(-9).map((l) => win(ledger, "q", l)),
        last5,
        prev5,
        last20: finite(ledger.tail(20).value),
        last45,
        wow: chg(last5, prev5),
        last5Vs45: chg(last5, last45),
        projectedQuarter: projected,
        projectedQoq: chg(projected, qPrev.value),
        daily: aumDaily,
        sinceQuarterStart: aumSinceQs,
        indexLow: aumExt.low,
        indexHigh: aumExt.high,
      },
      share: {
        quarters: shareQuarters,
        qoqBps: shareQuarters.length >= 2 ? (shareQuarters.at(-1)!.share - shareQuarters.at(-2)!.share) * 10000 : null,
        last5: eqLast5 && indLast5 ? eqLast5 / indLast5 : null,
        growthVsIndustry: eqQoq !== null && indQoq !== null ? eqQoq - indQoq : null,
      },
      sip,
      score,
      price: {
        close: cmp,
        closeDate: last?.date ?? null,
        weekAgoClose: weekAgo?.priceInr ?? null,
        weekChg: chg(cmp, weekAgo?.priceInr),
        quarterStartDate: qStart?.date ?? null,
        quarterStartClose: qStart?.priceInr ?? null,
        sinceQuarterStart: priceSinceQs,
        indexLow: priceExt.low,
        indexHigh: priceExt.high,
        vsAum: priceSinceQs !== null && aumSinceQs !== null ? (1 + priceSinceQs) / (1 + aumSinceQs) - 1 : null,
        indexed: priceIndexed,
      },
      ratio,
      regression,
      earnings: {
        pat,
        shares,
        epsTargetFy: shares && pat[raw.targetFy] != null ? pat[raw.targetFy]! / shares : null,
        peNow,
        peMean: finite(peBands?.mean),
        peSd: finite(peBands?.sd),
        peZ: finite(peBands?.zScore),
      },
      targets: { methods, average: bands(table.average), upside: bands(table.upside.average), noPat },
    });

    if (last && last.date !== asOf) warnings.push(`${tab.tab}: last close is ${last.date}, not ${asOf}`);
    if (entry.aumHistory.at(-1)?.date !== asOf) warnings.push(`${tab.tab}: last AUM day is ${entry.aumHistory.at(-1)?.date}, not ${asOf}`);
  }

  // The latest vendor report period imported (the live estimate runs from its month-end).
  const reportedThrough =
    raw.correlations.amcs
      .flatMap((a) => a.aumHistory.filter((p) => p.date <= asOf && p.reportPeriod).map((p) => p.reportPeriod))
      .sort()
      .at(-1) ?? null;
  const sipYoy = industrySipYoy(raw.flows, asOf, SIP_YOY_MONTHS);
  const labels = qLabels ?? { cur: iqCur, prev: iqPrev, yoy: iqYoy, mCur: indDefaults.m[0], mPrev: indDefaults.m[1], sessions: indCur.days };
  return {
    version: 1,
    asOf,
    weekEnding: asOf,
    generatedAt,
    sourceComputedAt: raw.correlations.computedAt ?? null,
    targetFy: raw.targetFy,
    weights: settings.weights,
    fitView,
    peRange: VALUATION_BAND_DEFAULT_RANGE,
    quarter: { label: labels.cur, prevLabel: labels.prev, yoyLabel: labels.yoy, sessions: labels.sessions, sessionsLeft, startDate: q.start, endDate: q.end },
    month: { label: labels.mCur, prevLabel: labels.mPrev },
    industry: {
      quarters: indQuarters,
      qoq: indQoq,
      yoy: chg(indCur.value, win(ind, "q", iqYoy).value),
      mCur: indMCur.value,
      mPrev: indMPrev.value,
      mom: chg(indMCur.value, indMPrev.value),
      last5: finite(ind.tail(5).value),
      prev5: finite(ind.tailPrev(5).value),
      wow: chg(ind.tail(5).value, ind.tailPrev(5).value),
      projectedQoq: chg(indProjected, indPrev.value),
      daily: indDaily.map((p) => ({ date: p.date, value: p.liveAumCr })),
      sinceQuarterStart: indDaily.length > 1 ? chg(indDaily.at(-1)!.liveAumCr, indDaily[0].liveAumCr) : null,
      sipYoy,
    },
    flows: [...raw.flows]
      .sort((a, b) => a.monthEndDate.localeCompare(b.monthEndDate))
      .filter((f) => f.monthEndDate <= asOf)
      .slice(-7)
      .map((f) => ({ month: f.monthEndDate, sipCr: finite(f.sipContributionsCr), equityNetCr: finite(f.equityNetFlowsCr) })),
    amcs,
    reportedThrough,
    alerts: weeklyAlerts(amcs, sipYoy?.z ?? null),
    nextWeek: nextWeekCalendar(asOf, {
      latestFlowMonthEnd: raw.flows.map((f) => f.monthEndDate).filter((d) => d <= asOf).sort().at(-1) ?? null,
      reportedThrough,
    }),
    warnings,
  };
}
