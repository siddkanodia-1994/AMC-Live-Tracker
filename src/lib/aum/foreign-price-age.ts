// Staleness tiers for the daily-cached Finnhub quotes and USD/INR rate (see
// foreign-pricing.ts). Kept free of DB imports so it can be unit-tested.
//
// The cache's as-of date is the IST date the GitHub Action *ran*, not the US
// trading date -- the job runs every day including weekends, so on a healthy
// day the age is 0-1 regardless of US holidays. A growing age therefore means
// the refresh job itself stopped (failed runs, or GitHub disabling scheduled
// workflows after 60 days without repo activity), which these tiers surface:
//   - up to FOREIGN_PRICE_STALE_AFTER_DAYS: "fresh" -- priced as live
//   - up to FOREIGN_PRICE_MAX_AGE_DAYS: "stale" -- price still used (so the
//     stored daily history doesn't jump), but labelled stale
//   - beyond that: "expired" -- fall back to the last reported value
export const FOREIGN_PRICE_STALE_AFTER_DAYS = 3;
export const FOREIGN_PRICE_MAX_AGE_DAYS = 7;

export type ForeignPriceAgeTier = "fresh" | "stale" | "expired";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from `asOfDate` to `todayIst` (both YYYY-MM-DD); null if either is unparseable. */
export function calendarDaysBetween(asOfDate: string, todayIst: string): number | null {
  const from = Date.parse(`${asOfDate}T00:00:00Z`);
  const to = Date.parse(`${todayIst}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / DAY_MS);
}

/** An unknown as-of date is treated as fresh, matching behaviour before tiers existed. */
export function classifyForeignPriceAge(ageDays: number | null): ForeignPriceAgeTier {
  if (ageDays === null || ageDays <= FOREIGN_PRICE_STALE_AFTER_DAYS) return "fresh";
  if (ageDays <= FOREIGN_PRICE_MAX_AGE_DAYS) return "stale";
  return "expired";
}

/** The worse of two tiers -- a quote is only as fresh as the FX rate it's converted with. */
export function worseTier(a: ForeignPriceAgeTier, b: ForeignPriceAgeTier): ForeignPriceAgeTier {
  const rank: Record<ForeignPriceAgeTier, number> = { fresh: 0, stale: 1, expired: 2 };
  return rank[a] >= rank[b] ? a : b;
}
