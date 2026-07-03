// Server runs in UTC on Vercel; shift to IST (UTC+5:30) so "today"/"now"
// align with Indian trading-day boundaries for daily snapshots, comparisons,
// and the live-clock badge.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function getIstDateString(): string {
  const istTime = new Date(Date.now() + IST_OFFSET_MS);
  return istTime.toISOString().slice(0, 10);
}

export function getIstTimeString(): string {
  const istTime = new Date(Date.now() + IST_OFFSET_MS);
  return istTime.toISOString().slice(11, 19);
}
