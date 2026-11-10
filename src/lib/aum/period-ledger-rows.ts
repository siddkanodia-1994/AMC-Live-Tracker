import type { LedgerPoint } from "./period-ledger";

// One-off exchange sessions that must not enter a ledger average, a day
// count or a weekday figure: Muhurat trading (an hour on Diwali) and the
// exchanges' disaster-recovery test sessions. The daily AUM series carries
// a value for them (the modelled pre-2026 history follows NIFTY 500 rows),
// so they are dropped here. Full trading days that happen to fall on a
// weekend -- 20 Jan 2024 and the Budget days 1 Feb 2025 / 1 Feb 2026 --
// are normal days and stay. Muhurat sessions from 2026 on are never
// written as trading days in the first place (see market-hours.ts).
export const LEDGER_SPECIAL_SESSIONS: ReadonlySet<string> = new Set([
  "2023-11-12", // Muhurat (Sunday)
  "2024-03-02", // DR test session (Saturday)
  "2024-05-18", // DR test session (Saturday)
  "2024-11-01", // Muhurat (Friday; otherwise a holiday)
  "2025-10-21", // Muhurat (Tuesday; otherwise a holiday)
]);

/** A daily AUM series → ledger points: one per observed day, special sessions removed. */
export function toLedgerPoints(history: { date: string; liveAumCr: number }[]): LedgerPoint[] {
  const points: LedgerPoint[] = [];
  for (const p of history) {
    if (LEDGER_SPECIAL_SESSIONS.has(p.date)) continue;
    if (!Number.isFinite(p.liveAumCr)) continue;
    points.push({ date: p.date, value: p.liveAumCr });
  }
  return points;
}
