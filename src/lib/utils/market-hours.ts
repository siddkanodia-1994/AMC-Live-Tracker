const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MARKET_OPEN_MINUTES = 9 * 60 + 15; // 9:15 AM
const MARKET_CLOSE_MINUTES = 15 * 60 + 30; // 3:30 PM

// NSE/BSE equity trading holidays, 2026 (excludes weekends, handled
// separately). Cross-checked against zerodha.com/marketintel/holiday-calendar
// and groww.in/p/nse-holidays. There's no API for this — update by hand every
// December for the following year. Muhurat trading (Sun 8 Nov 2026, Diwali)
// is a brief ceremonial session, deliberately NOT treated as a trading day.
const NSE_TRADING_HOLIDAYS_2026 = new Set([
  "2026-01-15", // Maharashtra municipal corporation election
  "2026-01-26", // Republic Day
  "2026-03-03", // Holi
  "2026-03-26", // Shri Ram Navami
  "2026-03-31", // Shri Mahavir Jayanti
  "2026-04-03", // Good Friday
  "2026-04-14", // Dr. Baba Saheb Ambedkar Jayanti
  "2026-05-01", // Maharashtra Day
  "2026-05-28", // Bakri Id
  "2026-06-26", // Muharram
  "2026-09-14", // Ganesh Chaturthi
  "2026-10-02", // Mahatma Gandhi Jayanti
  "2026-10-20", // Dussehra
  "2026-11-10", // Diwali-Balipratipada
  "2026-11-24", // Prakash Gurpurb Sri Guru Nanak Dev
  "2026-12-25", // Christmas
]);

export function toIstDateString(now: Date): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 10);
}

/**
 * Whether NSE/BSE are open for trading at all on this calendar day (IST) —
 * weekday and not a known holiday. Does not check time-of-day; a Monday at
 * 2 AM is still a trading day, just not currently open (see isMarketOpen).
 */
export function isTradingDay(now: Date = new Date()): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay(); // 0 = Sunday, 6 = Saturday (UTC getters on a shifted date = IST wall-clock fields)
  if (day === 0 || day === 6) return false;
  return !NSE_TRADING_HOLIDAYS_2026.has(toIstDateString(now));
}

/**
 * The most recent IST calendar day, strictly before `now`, that was an
 * actual trading day — used to label prices that were carried over from the
 * last trading day rather than fetched live (see compute-live-aum.ts's
 * "last_close" fallback). Pure calendar computation: independent of which
 * specific ISINs happen to have isin_daily_price rows, since per-ISIN gaps
 * don't all share one common "most recent" date (see getPreviousDayIsinPrices).
 */
export function lastTradingDayIstString(now: Date = new Date()): string {
  let cursor = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  for (let i = 0; i < 14 && !isTradingDay(cursor); i++) {
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return toIstDateString(cursor);
}

/**
 * NSE/BSE equity market hours: trading days only, 9:15 AM - 3:30 PM IST.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  if (!isTradingDay(now)) return false;

  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const minutesSinceMidnight = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutesSinceMidnight >= MARKET_OPEN_MINUTES && minutesSinceMidnight < MARKET_CLOSE_MINUTES;
}

/**
 * Milliseconds from `now` until the next market open (9:15 AM IST on the
 * next trading day -- today's, if today is a trading day and 9:15 AM hasn't
 * passed yet). Used to cap the off-hours live-AUM cache TTL so a computation
 * made shortly before market open can never stay cached past the moment
 * trading actually resumes, regardless of how long the flat off-hours TTL is
 * configured to be -- see compute-live-aum.ts's getOrCompute.
 */
export function msUntilNextMarketOpen(now: Date = new Date()): number {
  let cursor = new Date(now);
  for (let i = 0; i < 15; i++) {
    if (isTradingDay(cursor)) {
      const dateStr = toIstDateString(cursor);
      const marketOpenMs = Date.parse(`${dateStr}T00:00:00.000Z`) + MARKET_OPEN_MINUTES * 60_000 - IST_OFFSET_MS;
      if (marketOpenMs > now.getTime()) {
        return marketOpenMs - now.getTime();
      }
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  // Shouldn't happen given how sparse NSE holidays are; a safe, arbitrary fallback.
  return 24 * 60 * 60 * 1000;
}
