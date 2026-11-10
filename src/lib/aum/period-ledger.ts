// The "Period Ledger" design system's figures (the Exchanges dashboard's
// Revenue Summary, turned into a house standard), ported from its reference
// `PeriodLedger.compute()` so the AMC Analytics tab's AUM Summary reproduces
// it cell for cell. Every cell is a DAILY AVERAGE over a window of observed
// days (sum ÷ observed days), never a total, so a 20-day month and a 23-day
// month compare fairly. Changes are current ÷ reference − 1.
//
// Calendar: Indian FY (April–March), named by the year it ends in --
// `FY 2027` = Apr 2026–Mar 2027, `Q3 FY 2027` = Oct–Dec 2026, months as
// `FY 2027 November`. Periods always sort by time, never by label text.
//
// Rolling windows count OBSERVED days, not calendar days: "Last 5 Days" is
// the latest five rows whatever dates they fall on. Callers pass observed
// days only -- holidays absent (never zero), special sessions (Muhurat, DR
// test days) removed first (see period-ledger-rows.ts).

export const LEDGER_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const LEDGER_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
export type LedgerWeekday = (typeof LEDGER_WEEKDAYS)[number];

// Window lengths in observed days -- the design's defaults.
export const LEDGER_WINDOWS = { week: 5, mid: 20, long: 45, half: 125, dayShort: 3, dayLong: 10 } as const;

export interface LedgerPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface LedgerWindow {
  /** Daily average over the window; null when it has no observed day. */
  value: number | null;
  days: number;
}

export type LedgerPeriodKind = "fy" | "q" | "m";

interface CalendarDay {
  iso: string;
  dow: string;
  fyLabel: string;
  fyKey: number;
  qLabel: string;
  qKey: number;
  mLabel: string;
  mKey: number;
  value: number;
}

export function ledgerCalendarOf(iso: string): Omit<CalendarDay, "value"> {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const fy = m >= 4 ? y + 1 : y;
  const q = Math.floor(((m - 4 + 12) % 12) / 3) + 1;
  return {
    iso,
    dow: DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()],
    fyLabel: `FY ${fy}`,
    fyKey: fy,
    qLabel: `Q${q} FY ${fy}`,
    qKey: fy * 10 + q,
    mLabel: `FY ${fy} ${LEDGER_MONTHS[m - 1]}`,
    mKey: y * 100 + m,
  };
}

/** current ÷ reference − 1; null when either side is missing or the reference is 0. */
export function ledgerChange(current: number | null, reference: number | null): number | null {
  if (current == null || reference == null || !Number.isFinite(current) || !Number.isFinite(reference) || reference === 0) {
    return null;
  }
  return current / reference - 1;
}

export type LedgerTone = "pos" | "neg" | "neu";

/**
 * A change as a 1-decimal % with no "+" sign ("13.0%", "-2.6%"). The tone
 * comes from the ROUNDED figure, so −0.04% reads as a grey "0.0%".
 * (The design ships whole numbers; 1 decimal is this dashboard's choice.)
 */
export function formatLedgerPct(change: number | null): { text: string; tone: LedgerTone } | null {
  if (change == null || !Number.isFinite(change)) return null;
  let p = Math.round(change * 1000) / 10;
  if (p === 0) p = 0; // no "-0.0%"
  return { text: `${p.toFixed(1)}%`, tone: p > 0 ? "pos" : p < 0 ? "neg" : "neu" };
}

/** ₹ Cr figure with Indian digit grouping and no decimals: 456910.4 → "4,56,910". */
export function formatLedgerInr(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

function mean(rows: CalendarDay[]): number | null {
  if (rows.length === 0) return null;
  let sum = 0;
  for (const r of rows) sum += r.value;
  return sum / rows.length;
}

function windowOf(rows: CalendarDay[] | null | undefined): LedgerWindow {
  if (!rows || rows.length === 0) return { value: null, days: 0 };
  return { value: mean(rows), days: rows.length };
}

function labelsByKey(map: Map<string, number>): string[] {
  return [...map.entries()].sort((a, b) => a[1] - b[1]).map(([label]) => label);
}

export interface LedgerDefaults {
  fy: [string, string];
  q: [string, string, string, string];
  m: [string, string];
  /** Per weekday: the quarter table's three selectable rows. */
  wq: [string, string, string];
}

export interface PeriodLedger {
  /** Oldest first. */
  fys: string[];
  quarters: string[];
  months: string[];
  period(kind: LedgerPeriodKind, label: string | null | undefined): LedgerWindow;
  /** The `half` (125) observed days ending on the month's last observed day. */
  half(monthLabel: string | null | undefined): LedgerWindow;
  tail(n: number): LedgerWindow;
  /** The n days before the last n; empty under 2n days of data. */
  tailPrev(n: number): LedgerWindow;
  /** Mean of each weekday's latest value -- one of each, so a holiday can't count a weekday twice. */
  latestWeek(): LedgerWindow;
  dayLast(day: LedgerWeekday, n: number): LedgerWindow;
  dayInQuarter(day: LedgerWeekday, quarterLabel: string | null | undefined): LedgerWindow;
  day(day: LedgerWeekday): {
    latest: LedgerWindow;
    short: LedgerWindow;
    long: LedgerWindow;
    doShort: number | null;
    doLong: number | null;
  };
  dayQuarter(day: LedgerWeekday): {
    curLabel: string | null;
    prevLabel: string | null;
    yoyLabel: string | null;
    qoq: number | null;
    yoy: number | null;
  };
  defaults(): LedgerDefaults;
}

export function buildPeriodLedger(points: LedgerPoint[]): PeriodLedger {
  const rows: CalendarDay[] = points
    .filter((p) => p && typeof p.date === "string" && Number.isFinite(p.value))
    .map((p) => ({ ...ledgerCalendarOf(p.date.slice(0, 10)), value: p.value }))
    .sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));

  const by = {
    fy: new Map<string, CalendarDay[]>(),
    q: new Map<string, CalendarDay[]>(),
    m: new Map<string, CalendarDay[]>(),
    dow: new Map<string, CalendarDay[]>(),
  };
  const fyKeys = new Map<string, number>();
  const qKeys = new Map<string, number>();
  const mKeys = new Map<string, number>();
  const push = (map: Map<string, CalendarDay[]>, key: string, r: CalendarDay) => {
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  };
  for (const r of rows) {
    push(by.fy, r.fyLabel, r);
    push(by.q, r.qLabel, r);
    push(by.m, r.mLabel, r);
    push(by.dow, r.dow, r);
    fyKeys.set(r.fyLabel, r.fyKey);
    qKeys.set(r.qLabel, r.qKey);
    mKeys.set(r.mLabel, r.mKey);
  }
  const fys = labelsByKey(fyKeys);
  const quarters = labelsByKey(qKeys);
  const months = labelsByKey(mKeys);

  const dayLast = (day: LedgerWeekday, n: number): LedgerWindow => {
    const list = by.dow.get(day);
    return windowOf(list ? list.slice(-n) : null);
  };
  const dayInQuarter = (day: LedgerWeekday, quarterLabel: string | null | undefined): LedgerWindow => {
    const list = by.dow.get(day);
    return windowOf(list && quarterLabel ? list.filter((r) => r.qLabel === quarterLabel) : null);
  };

  return {
    fys,
    quarters,
    months,
    period(kind, label) {
      return windowOf(label ? by[kind].get(label) : null);
    },
    half(monthLabel) {
      let end = -1;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].mLabel === monthLabel) {
          end = i;
          break;
        }
      }
      return windowOf(end < 0 ? null : rows.slice(Math.max(0, end - LEDGER_WINDOWS.half + 1), end + 1));
    },
    tail(n) {
      return windowOf(rows.slice(-n));
    },
    tailPrev(n) {
      return windowOf(rows.length >= 2 * n ? rows.slice(-2 * n, -n) : null);
    },
    latestWeek() {
      const values: number[] = [];
      let days = 0;
      for (const d of LEDGER_WEEKDAYS) {
        const w = dayLast(d, 1);
        if (w.value != null) {
          values.push(w.value);
          days += w.days;
        }
      }
      return { value: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, days };
    },
    dayLast,
    dayInQuarter,
    day(day) {
      const latest = dayLast(day, 1);
      const short = dayLast(day, LEDGER_WINDOWS.dayShort);
      const long = dayLast(day, LEDGER_WINDOWS.dayLong);
      return {
        latest,
        short,
        long,
        doShort: ledgerChange(latest.value, short.value),
        doLong: ledgerChange(latest.value, long.value),
      };
    },
    dayQuarter(day) {
      const cur = quarters[quarters.length - 1] ?? null;
      const prev = quarters[quarters.length - 2] ?? null;
      let yoyLabel: string | null = null;
      const mt = cur ? /^Q(\d) FY (\d{4})$/.exec(cur) : null;
      if (mt) yoyLabel = `Q${mt[1]} FY ${Number(mt[2]) - 1}`;
      if (yoyLabel && !quarters.includes(yoyLabel)) yoyLabel = null;
      const c = dayInQuarter(day, cur);
      return {
        curLabel: cur,
        prevLabel: prev,
        yoyLabel,
        qoq: ledgerChange(c.value, dayInQuarter(day, prev).value),
        yoy: ledgerChange(c.value, dayInQuarter(day, yoyLabel).value),
      };
    },
    defaults() {
      const n = quarters.length;
      const q0 = n - 1;
      // Row 4: the nearest earlier quarter with the same Q number (the same
      // quarter a year earlier); failing that, the fifth-latest quarter.
      let q3 = Math.max(0, n - 5);
      const mt = /^Q(\d) /.exec(quarters[q0] ?? "");
      if (mt) {
        for (let i = q0 - 1; i >= 0; i--) {
          if (quarters[i].startsWith(`Q${mt[1]} `)) {
            q3 = i;
            break;
          }
        }
      }
      const at = (list: string[], i: number) => list[Math.max(0, Math.min(list.length - 1, i))] ?? "";
      return {
        fy: [at(fys, fys.length - 1), at(fys, fys.length - 2)],
        q: [at(quarters, q0), at(quarters, n - 2), at(quarters, n - 3), at(quarters, q3)],
        m: [at(months, months.length - 1), at(months, months.length - 2)],
        wq: [at(quarters, q0), at(quarters, n - 2), at(quarters, q3)],
      };
    },
  };
}
