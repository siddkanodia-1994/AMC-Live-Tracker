export const POLL_INTERVAL_MS = 45_000;
export const LIVE_AUM_CACHE_TTL_MS = 45_000;
// Prices can't move while NSE/BSE are closed, so a computation made outside
// market hours (evening/night on a trading day, or any non-trading day) is
// cached far longer than the 45s in-market TTL -- cuts wasted off-hours DHAN
// calls without ever showing a stale value: the first computation after
// close still genuinely fetches DHAN's frozen close, it just then gets
// reused for hours instead of re-fetched every 45s. 4h cycles several times
// over a ~17.75h overnight closure (15:30-9:15 IST) with wide margin before
// the next market open.
export const OFF_HOURS_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

// DHAN's documented limits: up to 1000 instruments per marketfeed request, 1 request/sec.
export const DHAN_MAX_INSTRUMENTS_PER_REQUEST = 1000;
export const DHAN_REQUEST_INTERVAL_MS = 1000;

export const CRORE = 1e7; // 1 crore = 10,000,000
