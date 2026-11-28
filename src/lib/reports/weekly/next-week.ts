// The weekly report's "Next week" calendar: only dated facts the dashboard
// itself depends on. Month / quarter ends and NSE holidays in the coming
// Mon–Fri, plus the next two data releases whenever they fall: AMFI's
// monthly industry data (the daily cron pulls it from the 8th) and the
// vendor's monthly portfolio file (after the 15th). The writer adds context.

import { addDaysToDateString } from "../../utils/date";
import { isTradingDay } from "../../utils/market-hours";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function isTrading(date: string): boolean {
  return isTradingDay(new Date(`${date}T06:30:00Z`));
}

function dow(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon 30 Nov". */
export function shortDate(date: string): string {
  return `${WEEKDAYS[dow(date)]} ${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3)}`;
}

/** Monday to Friday of the week after `asOf`. */
export function nextWeekWindow(asOf: string): { from: string; to: string } {
  let from = addDaysToDateString(asOf, 1);
  while (dow(from) !== 1) from = addDaysToDateString(from, 1);
  return { from, to: addDaysToDateString(from, 4) };
}

/** "2026-10" → "2026-11". */
function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function monthName(ym: string): string {
  return MONTHS[Number(ym.slice(5, 7)) - 1];
}

function lastDayOf(ym: string): string {
  return addDaysToDateString(`${nextMonth(ym)}-01`, -1);
}

export interface ReleaseState {
  /** Month-end date of the latest AMFI month the dashboard has ("2026-10-31"). */
  latestFlowMonthEnd: string | null;
  /** The latest vendor report period imported ("2026-10"). */
  reportedThrough: string | null;
}

export function nextWeekCalendar(
  asOf: string,
  releases: ReleaseState = { latestFlowMonthEnd: null, reportedThrough: null }
): { from: string; to: string; items: { date: string | null; title: string; detail: string }[] } {
  const { from, to } = nextWeekWindow(asOf);
  const days: string[] = [];
  for (let d = from; d <= to; d = addDaysToDateString(d, 1)) days.push(d);
  const items: { date: string | null; title: string; detail: string }[] = [];

  // A month whose last trading session falls in the window.
  for (const d of days) {
    if (!isTrading(d)) continue;
    let next = addDaysToDateString(d, 1);
    for (let i = 0; i < 10 && !isTrading(next); i++) next = addDaysToDateString(next, 1);
    if (next.slice(0, 7) === d.slice(0, 7)) continue;
    const lastSession = d;
    const m = Number(d.slice(5, 7));
    items.push({
      date: lastSession,
      title: `${MONTHS[m - 1]} closes`,
      detail: `${shortDate(lastSession)} is ${MONTHS[m - 1]}'s last session, which fixes the month's average AUM in the ledger.`,
    });
    if ([3, 6, 9, 12].includes(m)) {
      items.push({ date: lastSession, title: "Quarter-end", detail: `${shortDate(lastSession)} also closes the quarter: its average AUM becomes final.` });
    }
  }

  // AMFI's next monthly data: the month after the latest one stored, due
  // from the 8th of the month after that (AMFI usually publishes 8th–10th).
  if (releases.latestFlowMonthEnd) {
    const month = nextMonth(releases.latestFlowMonthEnd.slice(0, 7));
    const due = `${nextMonth(month)}-08`;
    const dueText = `${Number(due.slice(8))}–10 ${monthName(nextMonth(month)).slice(0, 3)}`;
    items.push({
      date: due,
      title: `AMFI ${monthName(month)} data`,
      detail:
        due > asOf
          ? `Expected around ${dueText}: the daily cron pulls industry SIP and equity net flows for ${monthName(month)} automatically from the 8th.`
          : `Due since ${shortDate(due)} and not stored yet: the daily cron keeps checking AMFI each day.`,
    });
  }

  // The vendor's next monthly portfolio file: the month after the latest one
  // imported, released after the 15th of the month that follows it.
  if (releases.reportedThrough) {
    const month = nextMonth(releases.reportedThrough);
    const after = `${nextMonth(month)}-15`;
    const since = lastDayOf(releases.reportedThrough);
    items.push({
      date: after,
      title: `${monthName(month)} portfolios (Mirae tracker)`,
      detail:
        after > asOf
          ? `Due after ${Number(after.slice(8))} ${monthName(nextMonth(month)).slice(0, 3)}: the ${monthName(month)} file resets each AMC's reported AUM, replacing the live estimate carried since ${Number(since.slice(8))} ${monthName(since.slice(0, 7)).slice(0, 3)}.`
          : `Released after ${Number(after.slice(8))} ${monthName(nextMonth(month)).slice(0, 3)} and not imported yet: run the ingest workflow on it, then import.`,
    });
  }

  for (const d of days) if (dow(d) >= 1 && dow(d) <= 5 && !isTrading(d)) items.push({ date: d, title: "Market holiday", detail: `NSE is closed on ${shortDate(d)}.` });

  return { from, to, items };
}
