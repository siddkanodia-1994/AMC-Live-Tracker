// Server runs in UTC on Vercel; shift to IST (UTC+5:30) so "today" aligns
// with Indian trading-day boundaries for daily snapshots and comparisons.
export function getIstDateString(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(Date.now() + IST_OFFSET_MS);
  return istTime.toISOString().slice(0, 10);
}
