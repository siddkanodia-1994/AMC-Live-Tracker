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

// "9 Jul 2026" -- short date for the live clock badge, computed the same
// IST-shifted way as the other two helpers so it flips at IST midnight, not
// the server's local midnight.
export function getIstShortDateString(): string {
  const istTime = new Date(Date.now() + IST_OFFSET_MS);
  return istTime.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Adds (or subtracts, for a negative `days`) whole calendar days to a
// "YYYY-MM-DD" string, e.g. addDaysToDateString("2026-07-12", -89) ->
// "2026-04-14". Parses as UTC midnight so this is pure calendar-day
// arithmetic, unaffected by IST or the server's local timezone.
export function addDaysToDateString(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
