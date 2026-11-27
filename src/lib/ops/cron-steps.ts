import type { OpsStatus } from "./run-log";

// Pure status rules for daily-cron steps, kept here so they're unit-testable.

/** Up to this many active (non-muted) stocks on last close is routine noise, not a warning. */
export const LAST_CLOSE_WARN_COUNT = 5;

/** ...unless one of them is this large across all funds (₹ cr, current period): a big holding on a stale price is worth a look even alone. */
export const LAST_CLOSE_LARGE_HOLDING_CR = 500;

/**
 * Status for the cron's computeLiveAum step. A single stuck stock (a merged,
 * suspended or thinly traded name) used to mark the whole run "warn" every
 * day; now a handful is reported in the summary but stays ok. Muted stocks
 * (manual Accept or the 5-day auto-mute) don't count. More than 5 is a warn,
 * so is any single one held above ₹500 cr across all funds (valueCrByIsin),
 * and DHAN fully unavailable is still a fail. The probe's price-coverage
 * check (< 95% live-priced) still catches anything broader.
 */
export function classifyLiveAumStep(
  dhanStatus: string,
  lastCloseStocks: { isin: string; companyName: string; autoMuted: boolean }[],
  amcCount: number,
  valueCrByIsin: ReadonlyMap<string, number> = new Map(),
): { status: OpsStatus; summary: string } {
  const active = lastCloseStocks.filter((s) => !s.autoMuted);
  const muted = lastCloseStocks.length - active.length;
  const large = active.filter((s) => (valueCrByIsin.get(s.isin) ?? 0) > LAST_CLOSE_LARGE_HOLDING_CR);
  const status: OpsStatus =
    dhanStatus === "unavailable" ? "fail" : dhanStatus === "degraded" && (active.length > LAST_CLOSE_WARN_COUNT || large.length > 0) ? "warn" : "ok";
  const label = (s: { isin: string; companyName: string }) => {
    const cr = valueCrByIsin.get(s.isin);
    return cr !== undefined && cr > LAST_CLOSE_LARGE_HOLDING_CR ? `${s.companyName} ₹${Math.round(cr).toLocaleString("en-IN")} cr` : s.companyName;
  };
  const listed = active.length <= LAST_CLOSE_WARN_COUNT ? active : large;
  const names = listed.length > 0 ? ` (${listed.map(label).join("; ")})` : "";
  return {
    status,
    summary: `${amcCount} AMCs snapshotted, DHAN ${dhanStatus}, ${active.length} on last close${names}${muted > 0 ? `, ${muted} muted` : ""}`,
  };
}

/** The weekly instrument sync runs on the 18:05 IST retry on Mondays (IST date). */
export function isInstrumentSyncDay(istDate: string): boolean {
  return new Date(`${istDate}T12:00:00+05:30`).getUTCDay() === 1;
}
