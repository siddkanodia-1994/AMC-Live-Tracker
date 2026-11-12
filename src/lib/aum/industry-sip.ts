import type { MonthlyFlowPoint } from "./industry-flows";

// AMFI's monthly industry SIP, as AMC Analytics' Industry SIP tab and the
// SIP & Score cards need it: plain month keys ("2026-09"), fiscal-quarter
// sums (Indian FY, Q1 = Apr–Jun) and the period ledger. Pure, so it runs
// on the client from /api/industry-monthly-flows.

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type SipByMonth = Map<string, number>;

/** "2026-09-30" → "2026-09" */
export function monthKey(monthEndDate: string): string {
  return monthEndDate.slice(0, 7);
}

export function sipByMonth(points: readonly MonthlyFlowPoint[]): SipByMonth {
  return new Map(points.map((p) => [monthKey(p.monthEndDate), p.sipContributionsCr]));
}

export function shiftMonth(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "2026-09" → "Sep 26" */
export function monthShortLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${String(y).slice(-2)}`;
}

export interface FiscalQuarter {
  fy: number;
  q: number;
}

export function fiscalQuarterOf(key: string): FiscalQuarter {
  const [y, m] = key.split("-").map(Number);
  return { fy: m >= 4 ? y + 1 : y, q: m >= 4 ? Math.ceil((m - 3) / 3) : 4 };
}

export function shiftQuarter({ fy, q }: FiscalQuarter, n: number): FiscalQuarter {
  const idx = fy * 4 + (q - 1) + n;
  return { fy: Math.floor(idx / 4), q: (idx % 4) + 1 };
}

export function quarterLabel({ fy, q }: FiscalQuarter): string {
  return `Q${q}FY${String(fy).slice(-2)}`;
}

function quarterMonths({ fy, q }: FiscalQuarter): string[] {
  const first = q === 4 ? `${fy}-01` : `${fy - 1}-${String(q * 3 + 1).padStart(2, "0")}`;
  return [first, shiftMonth(first, 1), shiftMonth(first, 2)];
}

/**
 * A fiscal quarter's SIP: the sum of its reported months, null when none
 * are in — the same rule as the Fortnightly industry quarterly card.
 */
export function quarterSip(byMonth: SipByMonth, quarter: FiscalQuarter): number | null {
  const real = quarterMonths(quarter)
    .map((k) => byMonth.get(k))
    .filter((v): v is number => v !== undefined);
  return real.length === 0 ? null : real.reduce((a, b) => a + b, 0);
}

function sumMonths(byMonth: SipByMonth, from: string, to: string): number | null {
  let sum = 0;
  let any = false;
  for (let k = from; k <= to; k = shiftMonth(k, 1)) {
    const v = byMonth.get(k);
    if (v !== undefined) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

/**
 * What the SIP cards' third row (two periods before the anchor) compares
 * against: the period before it and the same period a year earlier, from
 * AMFI. Quarterly: anchor Q2FY27 → row Q4FY26 vs Q3FY26 and Q4FY25.
 * Monthly: anchor September 2026 → row July 2026 vs June 2026 and July 2025.
 */
export function thirdRowQuarterBases(byMonth: SipByMonth, anchor: FiscalQuarter) {
  const row = shiftQuarter(anchor, -2);
  return { prev: quarterSip(byMonth, shiftQuarter(row, -1)), yoy: quarterSip(byMonth, shiftQuarter(row, -4)) };
}

export function thirdRowMonthBases(byMonth: SipByMonth, anchorYear: number, anchorMonth: number) {
  const row = shiftMonth(`${anchorYear}-${String(anchorMonth).padStart(2, "0")}`, -2);
  return { prev: byMonth.get(shiftMonth(row, -1)) ?? null, yoy: byMonth.get(shiftMonth(row, -12)) ?? null };
}

function change(current: number | null, base: number | null): number | null {
  return current !== null && base !== null && base !== 0 ? current / base - 1 : null;
}

export interface IndustrySipRow {
  key: string;
  label: string;
  value: number | null;
  /** QoQ / MoM; undefined where the block has no such column. */
  step?: number | null;
  yoy?: number | null;
  /** A muted reference row (FY to date's same period last year). */
  muted?: boolean;
}

export interface IndustrySipLedger {
  latestMonth: string;
  financialYear: IndustrySipRow[];
  quarter: IndustrySipRow[];
  month: IndustrySipRow[];
}

const LEDGER_FULL_YEARS = 4;
const LEDGER_QUARTERS = 6;
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The Industry SIP tab's period ledger (sums, not averages): FY to date
 * against the same months a year earlier, then full years with YoY; the
 * last 6 quarters with QoQ / YoY; the last `months` months with MoM / YoY.
 */
export function buildIndustrySipLedger(points: readonly MonthlyFlowPoint[], months: number): IndustrySipLedger | null {
  if (points.length === 0) return null;
  const byMonth = sipByMonth(points);
  const keys = [...byMonth.keys()].sort();
  const latest = keys[keys.length - 1];
  const first = keys[0];
  const { fy: latestFy } = fiscalQuarterOf(latest);

  const fyStart = (fy: number) => `${fy - 1}-04`;
  const fyLabel = (fy: number) => `FY${String(fy).slice(-2)}`;
  const ytd = sumMonths(byMonth, fyStart(latestFy), latest);
  const ytdPrev = sumMonths(byMonth, fyStart(latestFy - 1), shiftMonth(latest, -12));
  const fullYear = (fy: number) => (fyStart(fy) < first ? null : sumMonths(byMonth, fyStart(fy), `${fy}-03`));

  const financialYear: IndustrySipRow[] = [];
  const latestMonthNum = Number(latest.slice(5));
  if (latestMonthNum === 3) {
    // The year is complete: no "to date" row.
    financialYear.push({ key: `fy-${latestFy}`, label: fyLabel(latestFy), value: ytd, yoy: change(ytd, ytdPrev) });
  } else {
    financialYear.push({
      key: `fy-${latestFy}-ytd`,
      label: `${fyLabel(latestFy)} YTD (Apr–${MONTH_ABBR[latestMonthNum - 1]})`,
      value: ytd,
      yoy: change(ytd, ytdPrev),
    });
    financialYear.push({ key: `fy-${latestFy - 1}-same`, label: `${fyLabel(latestFy - 1)} same period`, value: ytdPrev, muted: true });
  }
  for (let fy = latestFy - 1; fy >= latestFy - LEDGER_FULL_YEARS; fy--) {
    const v = fullYear(fy);
    if (v === null) break;
    financialYear.push({ key: `fy-${fy}`, label: fyLabel(fy), value: v, yoy: change(v, fullYear(fy - 1)) });
  }

  const quarter: IndustrySipRow[] = [];
  const latestQ = fiscalQuarterOf(latest);
  for (let i = 0; i < LEDGER_QUARTERS; i++) {
    const qq = shiftQuarter(latestQ, -i);
    const v = quarterSip(byMonth, qq);
    if (v === null) break;
    quarter.push({
      key: quarterLabel(qq),
      label: quarterLabel(qq),
      value: v,
      step: change(v, quarterSip(byMonth, shiftQuarter(qq, -1))),
      yoy: change(v, quarterSip(byMonth, shiftQuarter(qq, -4))),
    });
  }

  const month: IndustrySipRow[] = [];
  for (let i = 0; i < Math.min(months, keys.length); i++) {
    const k = shiftMonth(latest, -i);
    const v = byMonth.get(k) ?? null;
    month.push({
      key: k,
      label: monthLabel(k),
      value: v,
      step: change(v, byMonth.get(shiftMonth(k, -1)) ?? null),
      yoy: change(v, byMonth.get(shiftMonth(k, -12)) ?? null),
    });
  }

  return { latestMonth: latest, financialYear, quarter, month };
}
