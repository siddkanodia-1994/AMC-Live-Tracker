import type { OpsStatus } from "./run-log";

// Pure status rules for daily-cron steps, kept here so they're unit-testable.

/** Up to this many active (non-muted) stocks on last close is routine noise, not a warning. */
export const LAST_CLOSE_WARN_COUNT = 5;

/**
 * Status for the cron's computeLiveAum step. A single stuck stock (a merged,
 * suspended or thinly traded name) used to mark the whole run "warn" every
 * day; now a handful is reported in the summary but stays ok. Muted stocks
 * (manual Accept or the 5-day auto-mute) don't count. More than 5 is a warn,
 * and DHAN fully unavailable is still a fail. The probe's price-coverage
 * check (< 95% live-priced) still catches anything broader.
 */
export function classifyLiveAumStep(
  dhanStatus: string,
  lastCloseStocks: { companyName: string; autoMuted: boolean }[],
  amcCount: number,
): { status: OpsStatus; summary: string } {
  const active = lastCloseStocks.filter((s) => !s.autoMuted);
  const muted = lastCloseStocks.length - active.length;
  const status: OpsStatus = dhanStatus === "unavailable" ? "fail" : dhanStatus === "degraded" && active.length > LAST_CLOSE_WARN_COUNT ? "warn" : "ok";
  const names = active.length > 0 && active.length <= LAST_CLOSE_WARN_COUNT ? ` (${active.map((s) => s.companyName).join("; ")})` : "";
  return {
    status,
    summary: `${amcCount} AMCs snapshotted, DHAN ${dhanStatus}, ${active.length} on last close${names}${muted > 0 ? `, ${muted} muted` : ""}`,
  };
}

/** The weekly instrument sync runs on the 18:05 IST retry on Mondays (IST date). */
export function isInstrumentSyncDay(istDate: string): boolean {
  return new Date(`${istDate}T12:00:00+05:30`).getUTCDay() === 1;
}
