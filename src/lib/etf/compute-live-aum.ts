import { db } from "../db/client";
import { etfDailyNav } from "../db/schema";
import { inArray, desc } from "drizzle-orm";
import { getEtfSchemesWithLatestPeriod } from "./ingest";

export interface EtfLiveAum {
  schemeId: number;
  slug: string;
  name: string;
  amc: string;
  assetClass: "gold" | "silver";
  reportPeriod: string | null;
  reportedAumCr: number | null; // AMFI's own average-for-the-quarter figure
  liveAumCr: number | null; // reportedAumCr scaled by NAV movement since that quarter's end
  deltaCr: number | null;
  deltaPct: number | null;
  navAtPeriodEnd: number | null;
  liveNav: number | null;
  liveNavDate: string | null;
}

/**
 * Live AUM for every tracked Gold/Silver ETF scheme:
 * `liveAumCr = reportedAumCr * (liveNav / navAtPeriodEnd)` -- the same
 * "units outstanding assumed constant since the last disclosure" shortcut
 * the equity side already uses for share counts, just one ratio per scheme
 * instead of a holdings sum (see ingest.ts for where reportedAumCr and
 * navAtPeriodEnd come from). A scheme with no captured period yet (e.g. a
 * brand-new ETF still in its first quarter) returns nulls rather than being
 * dropped, so the UI can show it as "not yet available" instead of omitting
 * it silently.
 */
export async function computeEtfLiveAum(): Promise<EtfLiveAum[]> {
  const schemesWithPeriod = await getEtfSchemesWithLatestPeriod();
  const schemeIds = schemesWithPeriod.map((s) => s.scheme.id);

  const latestNavBySchemeId = new Map<number, { nav: number; date: string }>();
  if (schemeIds.length > 0) {
    // One row per scheme: the most recent snapshot_date on or before today.
    // schemeIds.length is ~41, so ordering + a JS pass to keep only the
    // first (newest) row per scheme is simpler than a window-function query
    // for a table this small.
    const rows = await db
      .select()
      .from(etfDailyNav)
      .where(inArray(etfDailyNav.schemeId, schemeIds))
      .orderBy(desc(etfDailyNav.snapshotDate));
    for (const row of rows) {
      if (!latestNavBySchemeId.has(row.schemeId)) {
        latestNavBySchemeId.set(row.schemeId, { nav: Number(row.nav), date: row.snapshotDate });
      }
    }
  }

  return schemesWithPeriod.map(({ scheme, latestPeriod }) => {
    const liveNavRow = latestNavBySchemeId.get(scheme.id) ?? null;
    const reportedAumCr = latestPeriod ? Number(latestPeriod.reportedAumCr) : null;
    const navAtPeriodEnd = latestPeriod ? Number(latestPeriod.navAtPeriodEnd) : null;
    const liveNav = liveNavRow?.nav ?? null;

    let liveAumCr: number | null = null;
    if (reportedAumCr !== null && navAtPeriodEnd !== null && navAtPeriodEnd !== 0 && liveNav !== null) {
      liveAumCr = reportedAumCr * (liveNav / navAtPeriodEnd);
    }
    const deltaCr = liveAumCr !== null && reportedAumCr !== null ? liveAumCr - reportedAumCr : null;
    const deltaPct = deltaCr !== null && reportedAumCr !== null && reportedAumCr !== 0 ? deltaCr / reportedAumCr : null;

    return {
      schemeId: scheme.id,
      slug: scheme.slug,
      name: scheme.name,
      amc: scheme.amc,
      assetClass: scheme.assetClass as "gold" | "silver",
      reportPeriod: latestPeriod?.reportPeriod ?? null,
      reportedAumCr,
      liveAumCr,
      deltaCr,
      deltaPct,
      navAtPeriodEnd,
      liveNav,
      liveNavDate: liveNavRow?.date ?? null,
    };
  });
}
