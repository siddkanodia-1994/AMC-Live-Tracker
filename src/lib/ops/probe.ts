import { and, count, eq, gte, inArray, isNotNull, isNull, max, min, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  amcListedStock,
  amcPeriods,
  appSettings,
  dailyDataQuality,
  etfDailyNav,
  foreignPriceCache,
  holdings,
  instrumentMap,
  isinDailyPrice,
  liveAumDailySnapshot,
  mcxDailyPrice,
  opsRunLog,
  outageReclaimLog,
  staleMappingUnresolvedLog,
} from "../db/schema";
import { getDhanTokenStatus } from "../dhan/token";
import { isUsListedEquityIsin } from "../excel/instrument-classification";
import { calendarDaysBetween, classifyForeignPriceAge } from "../aum/foreign-price-age";
import { hasNseHolidayCalendar, isTradingDay, lastTradingDayIstString } from "../utils/market-hours";
import type { OpsRow } from "./run-log";

// Deterministic health checks for the data pipelines -- no LLM involved.
// Run by the ops-probe GitHub Action (17:00 IST weekdays) and readable by the
// Claude Code data-ops loop, which only spends reasoning on non-"ok" rows.
//
// Every query here is a bounded aggregate or a small filtered read (never a
// fetch-all-then-dedupe-in-JS -- see the Neon egress incident), so the probe
// costs a handful of tiny round trips per run.

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDateOf(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** IST date of the last day the daily cron should have captured a close for, as of `now`. */
function expectedCloseDate(now: Date): string {
  // The cron runs at 16:05 IST; before ~16:30 today's capture may not exist yet.
  const istMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  if (isTradingDay(now) && istMinutes >= 16 * 60 + 30) return istDateOf(now);
  return lastTradingDayIstString(now);
}

function ageDaysSince(date: string | null, today: string): number | null {
  return date ? calendarDaysBetween(date, today) : null;
}

/** Report period (YYYY-MM) whose vendor file should normally be available by `today`. */
export function expectedReportPeriod(today: string): { period: string; graceOver: boolean } {
  const [y, m, d] = today.split("-").map(Number);
  // Month M's file is released after the 15th of M+1 (see the Mirae cadence
  // note); allow until the 25th before calling it overdue.
  const monthsBack = d > 15 ? 1 : 2;
  const dt = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  return { period: dt.toISOString().slice(0, 7), graceOver: d >= 25 };
}

export interface InstrumentMapGap {
  isin: string;
  name: string;
  valueCr: number;
}

// Unmapped priceable holdings stay at their reported value in live AUM, so
// the risk is the value that silently stops moving with the market. A
// handful of long-delisted names reported at ₹0 is permanent background;
// a demerged stock awaiting listing (HEG Graphite, ~₹616 cr in 2026-09) is
// the case worth a nudge to run "Sync Instruments" once it lists.
export const INSTRUMENT_GAP_TOTAL_WARN_CR = 500;
export const INSTRUMENT_GAP_SINGLE_WARN_CR = 200;

/** Status + summary for the instrument-map-gaps check; `top` is the largest gaps, biggest first. */
export function classifyInstrumentMapGaps(gapCount: number, totalCr: number, top: InstrumentMapGap[]): { status: "ok" | "warn"; summary: string } {
  if (gapCount === 0) return { status: "ok", summary: "every priceable current-period holding has a DHAN mapping" };
  const largestCr = Math.max(0, ...top.map((g) => g.valueCr));
  const overTotal = totalCr > INSTRUMENT_GAP_TOTAL_WARN_CR;
  const overSingle = largestCr > INSTRUMENT_GAP_SINGLE_WARN_CR;
  const cr = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(2));
  const breaches = [
    overTotal ? `total > ₹${INSTRUMENT_GAP_TOTAL_WARN_CR} cr` : null,
    overSingle ? `one ISIN > ₹${INSTRUMENT_GAP_SINGLE_WARN_CR} cr` : null,
  ].filter((b) => b !== null);
  return {
    status: overTotal || overSingle ? "warn" : "ok",
    summary:
      `${gapCount} priceable ISIN(s) unmapped, ₹${cr(totalCr)} cr held at reported value` +
      (breaches.length > 0 ? ` (${breaches.join(", ")})` : "") +
      `; top: ${top.slice(0, 3).map((g) => `${g.name} ₹${cr(g.valueCr)} cr`).join("; ")}`,
  };
}

export async function runProbe(now: Date = new Date()): Promise<OpsRow[]> {
  const rows: OpsRow[] = [];
  const today = istDateOf(now);
  const closeDate = expectedCloseDate(now);

  const check = async (node: string, fn: () => Promise<Omit<OpsRow, "node">>) => {
    const started = Date.now();
    try {
      rows.push({ node, ...(await fn()), durationMs: Date.now() - started });
    } catch (err) {
      rows.push({ node, status: "fail", summary: `probe check errored: ${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - started });
    }
  };

  const [periodRow] = await db.select().from(appSettings).where(eq(appSettings.key, "current_report_period"));
  const currentPeriod = periodRow?.value ?? null;

  await check("daily-cron-ran", async () => {
    // The run for the most recent close we should have (today after ~16:30
    // IST on a trading day, otherwise the last trading day).
    const since = new Date(`${closeDate}T00:00:00+05:30`);
    const [r] = await db
      .select({ status: opsRunLog.status, summary: opsRunLog.summary })
      .from(opsRunLog)
      .where(and(eq(opsRunLog.loop, "daily-snapshot"), eq(opsRunLog.node, "run-complete"), gte(opsRunLog.createdAt, since)))
      .orderBy(sql`${opsRunLog.createdAt} desc`)
      .limit(1);
    if (!r) return { status: "fail", summary: `no daily-snapshot run recorded for ${closeDate}` };
    return { status: r.status === "ok" || r.status === "warn" ? r.status : "fail", summary: r.summary };
  });

  await check("snapshot-coverage", async () => {
    if (!currentPeriod) return { status: "fail", summary: "current_report_period not set" };
    const [{ amcCount }] = await db.select({ amcCount: count() }).from(amcPeriods).where(eq(amcPeriods.reportPeriod, currentPeriod));
    const [{ snapCount }] = await db
      .select({ snapCount: count() })
      .from(liveAumDailySnapshot)
      .where(and(eq(liveAumDailySnapshot.snapshotDate, closeDate), eq(liveAumDailySnapshot.isCanonical, true)));
    const ok = snapCount >= amcCount && amcCount > 0;
    return {
      status: ok ? "ok" : "fail",
      summary: `${snapCount}/${amcCount} AMC snapshots for ${closeDate}`,
      details: { closeDate, snapCount, amcCount, currentPeriod },
    };
  });

  await check("price-coverage", async () => {
    const [r] = await db.select().from(dailyDataQuality).where(eq(dailyDataQuality.snapshotDate, closeDate));
    if (!r) return { status: "fail", summary: `no daily_data_quality row for ${closeDate}` };
    const pct = Number(r.coveragePct);
    // Normal days are ~99%+; an outage day collapses to low single digits.
    return {
      status: pct >= 95 ? "ok" : pct >= 50 ? "warn" : "fail",
      summary: `${pct.toFixed(1)}% of Indian stocks live-priced on ${closeDate}`,
      details: { closeDate, coveragePct: pct, liveConsidered: r.liveConsidered, indianStocks: r.indianStocks },
    };
  });

  await check("dhan-token-age", async () => {
    const status = await getDhanTokenStatus();
    if (!status.configured || !status.updatedAt) return { status: "fail", summary: "DHAN token not configured" };
    const hours = (now.getTime() - Date.parse(status.updatedAt)) / 3_600_000;
    // DHAN tokens expire ~24h after generation; refreshing is a manual step.
    return {
      status: hours <= 20 ? "ok" : hours <= 24 ? "warn" : "fail",
      summary: `token refreshed ${hours.toFixed(1)}h ago${hours > 24 ? " -- likely expired, refresh at /admin" : ""}`,
      details: { updatedAt: status.updatedAt, hours: Math.round(hours * 10) / 10 },
    };
  });

  await check("outage-reclaims", async () => {
    const open = await db
      .select({ kind: outageReclaimLog.kind, snapshotDate: outageReclaimLog.snapshotDate, status: outageReclaimLog.status, detail: outageReclaimLog.detail })
      .from(outageReclaimLog)
      .where(inArray(outageReclaimLog.status, ["detected", "failed"]))
      .limit(50);
    if (open.length === 0) return { status: "ok", summary: "no outage days awaiting correction" };
    return {
      status: open.some((o) => o.status === "failed") ? "fail" : "warn",
      summary: `${open.length} outage day(s) awaiting correction: ${[...new Set(open.map((o) => o.snapshotDate))].join(", ")}`,
      details: { open },
    };
  });

  await check("unresolved-stale-mappings", async () => {
    const open = await db
      .select({ isin: staleMappingUnresolvedLog.isin, companyName: staleMappingUnresolvedLog.companyName, firstCheckedAt: staleMappingUnresolvedLog.firstCheckedAt })
      .from(staleMappingUnresolvedLog)
      .limit(50);
    if (open.length === 0) return { status: "ok", summary: "none" };
    const oldestDays = Math.max(...open.map((o) => Math.floor((now.getTime() - o.firstCheckedAt.getTime()) / DAY_MS)));
    return {
      status: oldestDays >= 14 ? "warn" : "ok",
      summary: `${open.length} unresolved; oldest ${oldestDays} days (${open.map((o) => o.companyName).join("; ").slice(0, 300)})`,
      details: { open: open.map((o) => ({ ...o, firstCheckedAt: o.firstCheckedAt.toISOString() })) },
    };
  });

  await check("instrument-map-gaps", async () => {
    // Priceable current-period holdings with no instrument_map row (live AUM
    // keeps them at reported value). One round trip: the grouped subquery
    // ranks ISINs by value so the outer aggregate returns count, total and
    // only the top 3 -- never the full list.
    if (!currentPeriod) return { status: "skipped", summary: "no current period" };
    const gaps = db
      .select({
        isin: holdings.isin,
        name: sql<string>`min(${holdings.companyName})`.as("name"),
        valueCr: sql<string>`sum(${holdings.marketValueCr})`.as("value_cr"),
        rank: sql<number>`row_number() over (order by sum(${holdings.marketValueCr}) desc)`.as("rank"),
      })
      .from(holdings)
      .leftJoin(instrumentMap, eq(instrumentMap.isin, holdings.isin))
      .where(and(eq(holdings.reportPeriod, currentPeriod), eq(holdings.isPriceable, true), isNotNull(holdings.isin), isNull(instrumentMap.isin)))
      .groupBy(holdings.isin)
      .as("gaps");
    const [agg] = await db
      .select({
        n: count(),
        totalCr: sql<string>`coalesce(sum(${gaps.valueCr}), 0)`,
        top: sql<InstrumentMapGap[] | null>`json_agg(json_build_object('isin', ${gaps.isin}, 'name', ${gaps.name}, 'valueCr', ${gaps.valueCr}) order by ${gaps.valueCr} desc) filter (where ${gaps.rank} <= 3)`,
      })
      .from(gaps);
    const top = (agg.top ?? []).map((g) => ({ ...g, valueCr: Number(g.valueCr) }));
    const totalCr = Number(agg.totalCr);
    return {
      ...classifyInstrumentMapGaps(agg.n, totalCr, top),
      details: { currentPeriod, unmapped: agg.n, totalCr: Math.round(totalCr * 100) / 100, top },
    };
  });

  await check("foreign-prices-age", async () => {
    // Only ISINs actually held in the current period matter (orphaned cache
    // rows for dropped holdings are ignored).
    if (!currentPeriod) return { status: "skipped", summary: "no current period" };
    const held = await db
      .selectDistinct({ isin: holdings.isin })
      .from(holdings)
      .where(and(eq(holdings.reportPeriod, currentPeriod), eq(holdings.isPriceable, false)));
    const usIsins = held.map((h) => h.isin).filter((i): i is string => i !== null && isUsListedEquityIsin(i));
    if (usIsins.length === 0) return { status: "skipped", summary: "no US-listed holdings" };
    const [agg] = await db
      .select({ oldest: min(foreignPriceCache.asOfDate), newest: max(foreignPriceCache.asOfDate), n: count() })
      .from(foreignPriceCache)
      .where(inArray(foreignPriceCache.isin, usIsins.slice(0, 500)));
    const [fx] = await db.select().from(appSettings).where(eq(appSettings.key, "usd_inr_rate_as_of"));
    const quoteTier = classifyForeignPriceAge(ageDaysSince(agg.oldest, today));
    const fxTier = classifyForeignPriceAge(ageDaysSince(fx?.value ?? null, today));
    const worst = quoteTier === "expired" || fxTier === "expired" ? "fail" : quoteTier === "stale" || fxTier === "stale" ? "warn" : "ok";
    return {
      status: worst,
      summary: `${agg.n}/${usIsins.length} held US quotes cached, oldest ${agg.oldest}, FX as of ${fx?.value ?? "unknown"}`,
      details: { held: usIsins.length, cached: agg.n, oldest: agg.oldest, newest: agg.newest, fxAsOf: fx?.value ?? null },
    };
  });

  await check("etf-nav-freshness", async () => {
    const [r] = await db.select({ latest: max(etfDailyNav.snapshotDate) }).from(etfDailyNav);
    const age = ageDaysSince(r.latest, today);
    // TigZig reports the last AMFI NAV date, typically 1 business day behind.
    return { status: age !== null && age <= 4 ? "ok" : "warn", summary: `latest ETF NAV ${r.latest ?? "none"}`, details: { latest: r.latest, ageDays: age } };
  });

  await check("mcx-freshness", async () => {
    // MCX trades until ~23:30 IST, so the 16:05 cron can only ever capture
    // the session BEFORE the close date (found by the data-ops loop's first
    // run, 2026-11-03) -- expect one trading day of lag, not zero.
    const expected = lastTradingDayIstString(new Date(`${closeDate}T12:00:00+05:30`));
    const [r] = await db.select({ latest: max(mcxDailyPrice.snapshotDate) }).from(mcxDailyPrice);
    return {
      status: r.latest !== null && r.latest >= expected ? "ok" : "warn",
      summary: `latest MCX price ${r.latest ?? "none"} (expected ≥ ${expected})`,
      details: { latest: r.latest, expected },
    };
  });

  await check("listed-amc-share-prices", async () => {
    const listed = await db.select({ isin: amcListedStock.isin }).from(amcListedStock);
    const [r] = await db
      .select({ latest: max(isinDailyPrice.snapshotDate) })
      .from(isinDailyPrice)
      .where(inArray(isinDailyPrice.isin, listed.map((l) => l.isin)));
    return { status: r.latest !== null && r.latest >= lastTradingDayIstString(now) ? "ok" : "warn", summary: `latest listed-AMC close ${r.latest ?? "none"}`, details: { latest: r.latest, amcs: listed.length } };
  });

  await check("amc-score-supabase", async () => {
    const url = process.env.AMC_SCORE_SUPABASE_URL;
    const key = process.env.AMC_SCORE_SUPABASE_KEY;
    if (!url || !key) return { status: "skipped", summary: "AMC_SCORE_SUPABASE_* not configured for the probe" };
    const res = await fetch(`${url}/rest/v1/amc_scores?select=snapshot_date&order=snapshot_date.desc&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return { status: "fail", summary: `Supabase returned HTTP ${res.status}` };
    const [latest] = (await res.json()) as { snapshot_date: string }[];
    const age = ageDaysSince(latest?.snapshot_date ?? null, today);
    // Scores are fortnightly snapshots; > 35 days means the external loader stalled.
    return { status: age !== null && age <= 35 ? "ok" : "warn", summary: `latest AMC Score snapshot ${latest?.snapshot_date ?? "none"}`, details: { latest: latest?.snapshot_date ?? null, ageDays: age } };
  });

  await check("vendor-file-due", async () => {
    const { period, graceOver } = expectedReportPeriod(today);
    if (!currentPeriod) return { status: "fail", summary: "current_report_period not set" };
    if (currentPeriod >= period) return { status: "ok", summary: `current period ${currentPeriod} (expected ≥ ${period})` };
    return {
      status: graceOver ? "warn" : "ok",
      summary: `current period ${currentPeriod}; ${period} file ${graceOver ? "looks overdue" : "not due yet (vendor releases after the 15th)"}`,
      details: { currentPeriod, expected: period },
    };
  });

  await check("holiday-calendar", async () => {
    const [y, m, d] = today.split("-").map(Number);
    if (m < 12) return { status: hasNseHolidayCalendar(y) ? "ok" : "fail", summary: `${y} holidays ${hasNseHolidayCalendar(y) ? "loaded" : "MISSING"}` };
    const next = hasNseHolidayCalendar(y + 1);
    return {
      status: next ? "ok" : d >= 20 ? "fail" : "warn",
      summary: next ? `${y + 1} holidays loaded` : `${y + 1} NSE holidays not loaded yet -- add to market-hours.ts once NSE publishes`,
    };
  });

  return rows;
}
