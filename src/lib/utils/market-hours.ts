const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MARKET_OPEN_MINUTES = 9 * 60 + 15; // 9:15 AM
const MARKET_CLOSE_MINUTES = 15 * 60 + 30; // 3:30 PM

/**
 * NSE/BSE equity market hours: Mon-Fri, 9:15 AM - 3:30 PM IST. Day-of-week +
 * time-of-day only — does not account for market holidays (Diwali, Republic
 * Day, etc.), which would need a maintained annual calendar.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay(); // 0 = Sunday, 6 = Saturday (UTC getters on a shifted date = IST wall-clock fields)
  if (day === 0 || day === 6) return false;

  const minutesSinceMidnight = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutesSinceMidnight >= MARKET_OPEN_MINUTES && minutesSinceMidnight < MARKET_CLOSE_MINUTES;
}
