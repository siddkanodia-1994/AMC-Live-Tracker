import { inArray, eq, desc } from "drizzle-orm";
import { db } from "../db/client";
import { etfSchemes, etfDailyNav, etfPeriodAum } from "../db/schema";
import { fetchLatestNav, fetchLatestAaumSnapshot, fetchNavAsOf } from "./tigzig-client";

export interface EtfIngestResult {
  schemesTracked: number;
  navRowsUpserted: number;
  splitsDetected: { schemeName: string; ratio: number; date: string }[];
  newPeriodsCaptured: { schemeName: string; reportPeriod: string; reportedAumCr: number }[];
  warnings: string[];
}

// Same shape as split-detection.ts's approach for equities (clean-ratio
// matching within a tolerance), applied here to a scheme's own day-over-day
// NAV instead of a stock's close-to-close price -- confirmed necessary by a
// real incident (DSP Gold/Silver ETF both did a genuine ~10:1 unit split on
// 2026-08-28, which silently broke the live-AUM ratio for both until caught
// by manual review). >=2 only: gold/silver ETFs can move a few % a day on
// real commodity price swings, but never cleanly double or more from price
// alone.
const SPLIT_CANDIDATE_RATIOS = [2, 3, 4, 5, 10, 20, 25, 50, 100];
const SPLIT_TOLERANCE_PCT = 0.08;

function findCleanSplitRatio(previousNav: number, currentNav: number): number | null {
  if (previousNav <= 0 || currentNav <= 0) return null;
  const rawRatio = previousNav / currentNav; // >1 if NAV dropped (split), <1 if it rose (reverse split/consolidation)
  const testRatio = rawRatio >= 1 ? rawRatio : 1 / rawRatio;
  let best: number | null = null;
  let bestDeviation = Infinity;
  for (const candidate of SPLIT_CANDIDATE_RATIOS) {
    const deviation = Math.abs(testRatio - candidate) / candidate;
    if (deviation <= SPLIT_TOLERANCE_PCT && deviation < bestDeviation) {
      best = candidate;
      bestDeviation = deviation;
    }
  }
  if (best === null) return null;
  return rawRatio >= 1 ? best : 1 / best; // back to "previousNav / currentNav" direction
}

/**
 * "Latest" period row per scheme by capturedAt, not by string-sorting
 * reportPeriod -- TigZig's labels ("June-2026", "March-2026") don't sort
 * chronologically as plain strings. capturedAt only moves forward for a
 * given scheme by construction (a period row is only ever created/touched
 * in runEtfIngestion, and only when it's genuinely the newest one TigZig
 * reports), so it's a reliable ordering key.
 */
function latestPeriodBySchemeId(periods: (typeof etfPeriodAum.$inferSelect)[]): Map<number, (typeof etfPeriodAum.$inferSelect)> {
  const map = new Map<number, (typeof etfPeriodAum.$inferSelect)>();
  for (const p of periods) {
    const current = map.get(p.schemeId);
    if (!current || p.capturedAt > current.capturedAt) map.set(p.schemeId, p);
  }
  return map;
}

/**
 * Daily ingestion for the Gold/Silver ETF tab, meant to run once a day
 * alongside the existing equity computation (see the daily-snapshot cron).
 * Three independent steps, each best-effort:
 *  1. Pull today's NAV for every tracked scheme (this changes every day),
 *     checking each one for a clean-ratio jump vs. its own prior day first
 *     (a genuine unit split) and correcting the stored baseline if so.
 *  2. Check whether a new quarter's AAUM has appeared for any scheme since
 *     last capture; if so, capture it as that scheme's new baseline,
 *     anchored to the NAV as of that exact quarter-end date (not today's).
 * Both steps are idempotent (upsert on the same unique keys the schema
 * already enforces), so a retry or a duplicate cron run is harmless.
 */
export async function runEtfIngestion(): Promise<EtfIngestResult> {
  const warnings: string[] = [];
  const schemes = await db.select().from(etfSchemes);
  const schemeCodes = schemes.map((s) => s.schemeCode);

  if (schemes.length === 0) {
    return { schemesTracked: 0, navRowsUpserted: 0, splitsDetected: [], newPeriodsCaptured: [], warnings: ["No ETF schemes registered yet."] };
  }

  const periodBySchemeId = latestPeriodBySchemeId(await db.select().from(etfPeriodAum));

  // Step 1: the latest NAV for every tracked scheme, stored under its own
  // real date (whatever TigZig reports -- the last actual trading day, not
  // forced to "today"). Mirrors the equity side's philosophy: a non-trading
  // day just has no row of its own, and readers fall back to the nearest
  // prior date at query time rather than the ingest step manufacturing one.
  const navMap = await fetchLatestNav(schemeCodes);

  // Prior-day NAV per scheme, for the split check below -- the most recent
  // stored row strictly before whatever date each scheme's fresh fetch
  // reports (usually "yesterday", but tolerates a gap if ingestion missed a
  // day). One bounded query for every scheme's whole recent history is
  // simpler than per-scheme queries and this table is small.
  const schemeById = new Map(schemes.map((s) => [s.id, s]));
  const priorNavRows = await db
    .select()
    .from(etfDailyNav)
    .where(inArray(etfDailyNav.schemeId, schemes.map((s) => s.id)))
    .orderBy(desc(etfDailyNav.snapshotDate));
  const mostRecentPriorNavBySchemeId = new Map<number, number>();
  for (const row of priorNavRows) {
    if (mostRecentPriorNavBySchemeId.has(row.schemeId)) continue;
    const fresh = navMap.get(schemeById.get(row.schemeId)?.schemeCode ?? -1);
    if (fresh && row.snapshotDate >= fresh.date) continue; // same day as today's fetch, not a "prior" day
    mostRecentPriorNavBySchemeId.set(row.schemeId, Number(row.nav));
  }

  let navRowsUpserted = 0;
  const splitsDetected: EtfIngestResult["splitsDetected"] = [];
  for (const scheme of schemes) {
    const row = navMap.get(scheme.schemeCode);
    if (!row) {
      warnings.push(`[${scheme.name}] No NAV returned by TigZig today.`);
      continue;
    }

    const priorNav = mostRecentPriorNavBySchemeId.get(scheme.id);
    const currentPeriod = periodBySchemeId.get(scheme.id);
    if (priorNav !== undefined && currentPeriod) {
      const ratio = findCleanSplitRatio(priorNav, row.nav);
      if (ratio !== null) {
        // Scale the current baseline's navAtPeriodEnd by the same ratio so
        // the live-AUM formula keeps comparing like-for-like going forward
        // -- exactly the correction applied manually for the confirmed
        // 2026-08-28 DSP Gold/Silver ETF split that motivated this check.
        const correctedNav = Number(currentPeriod.navAtPeriodEnd) / ratio;
        await db.update(etfPeriodAum).set({ navAtPeriodEnd: String(correctedNav) }).where(eq(etfPeriodAum.id, currentPeriod.id));
        currentPeriod.navAtPeriodEnd = String(correctedNav);
        splitsDetected.push({ schemeName: scheme.name, ratio, date: row.date });
        warnings.push(
          `[${scheme.name}] Detected a ~${ratio}:1 NAV split on ${row.date} (₹${priorNav} → ₹${row.nav}) — baseline NAV corrected automatically.`
        );
      }
    }

    await db
      .insert(etfDailyNav)
      .values({ schemeId: scheme.id, snapshotDate: row.date, nav: String(row.nav) })
      .onConflictDoUpdate({
        target: [etfDailyNav.schemeId, etfDailyNav.snapshotDate],
        set: { nav: String(row.nav), computedAt: new Date() },
      });
    navRowsUpserted++;
  }

  // Step 2: quarter-rollover check. AAUM only changes once a quarter, so on
  // all but one day a cycle this is a no-op after the comparison below --
  // cheap enough to just always check rather than trying to predict when a
  // new quarter lands.
  const aaumMap = await fetchLatestAaumSnapshot(schemeCodes);

  const schemesNeedingNewPeriod = schemes.filter((scheme) => {
    const aaum = aaumMap.get(scheme.schemeCode);
    if (!aaum) return false;
    const existing = periodBySchemeId.get(scheme.id);
    return !existing || aaum.aaumQuarter !== existing.reportPeriod;
  });

  const newPeriodsCaptured: EtfIngestResult["newPeriodsCaptured"] = [];
  if (schemesNeedingNewPeriod.length > 0) {
    // All schemes rolling over in the same run share the same quarter-end
    // date in practice (AMFI's quarters are calendar-aligned), so one
    // batched as-of lookup covers all of them.
    const quarterEndDates = new Set(
      schemesNeedingNewPeriod.map((s) => aaumMap.get(s.schemeCode)?.aaumQuarterEnd).filter((d): d is string => !!d)
    );
    const navAsOfByDate = new Map<string, Map<number, { nav: number }>>();
    for (const date of quarterEndDates) {
      navAsOfByDate.set(date, await fetchNavAsOf(schemesNeedingNewPeriod.map((s) => s.schemeCode), date));
    }

    for (const scheme of schemesNeedingNewPeriod) {
      const aaum = aaumMap.get(scheme.schemeCode)!;
      if (!aaum.aaumQuarterEnd) {
        warnings.push(`[${scheme.name}] New quarter "${aaum.aaumQuarter}" detected but no quarter-end date given — skipped.`);
        continue;
      }
      const navRow = navAsOfByDate.get(aaum.aaumQuarterEnd)?.get(scheme.schemeCode);
      if (!navRow) {
        warnings.push(`[${scheme.name}] Could not fetch NAV as of ${aaum.aaumQuarterEnd} for the new quarter — skipped.`);
        continue;
      }
      await db
        .insert(etfPeriodAum)
        .values({
          schemeId: scheme.id,
          reportPeriod: aaum.aaumQuarter,
          reportedAumCr: String(aaum.aaumCr),
          navAtPeriodEnd: String(navRow.nav),
        })
        .onConflictDoUpdate({
          target: [etfPeriodAum.schemeId, etfPeriodAum.reportPeriod],
          set: { reportedAumCr: String(aaum.aaumCr), navAtPeriodEnd: String(navRow.nav), capturedAt: new Date() },
        });
      newPeriodsCaptured.push({ schemeName: scheme.name, reportPeriod: aaum.aaumQuarter, reportedAumCr: aaum.aaumCr });
    }
  }

  return { schemesTracked: schemes.length, navRowsUpserted, splitsDetected, newPeriodsCaptured, warnings };
}

/**
 * Every tracked scheme with its latest AUM baseline joined -- used by the
 * live computation.
 */
export async function getEtfSchemesWithLatestPeriod() {
  const schemes = await db.select().from(etfSchemes);
  const periods = await db.select().from(etfPeriodAum);
  const byScheme = latestPeriodBySchemeId(periods);
  return schemes.map((s) => ({ scheme: s, latestPeriod: byScheme.get(s.id) ?? null }));
}
