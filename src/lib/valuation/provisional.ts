// Daily PE and Mcap/Sales for the days after the last Ace Equity upload.
// Ace's trailing ratios are price ÷ TTM EPS and price ÷ TTM sales per share,
// and within a quarter only the price moves (the implied EPS was flat to
// ~0.1% a day across all 8 AMCs). So the latest Ace rows are used as the
// anchor: back out TTM EPS and sales per share from their DHAN closes, hold
// them fixed, and rescale by each later close. Pure -- no I/O. Nothing here
// is ever stored; the next Ace upload replaces these days with real rows.

export interface ValuationAnchor {
  date: string;
  pe: number | null;
  mcapToSales: number | null;
}

export interface PriceClose {
  date: string;
  priceInr: number;
}

export interface ProvisionalValuationPoint {
  date: string;
  pe: number | null;
  mcapToSales: number | null;
  provisional: true;
}

export interface ProvisionalFill {
  points: ProvisionalValuationPoint[];
  // The first quarter-end after the anchor that the fill has run past --
  // from then on Ace will have rolled in a new quarter's earnings, so the
  // held TTM figures may be out of date. null while still inside the quarter.
  staleSince: string | null;
}

const QUARTER_ENDS = ["03-31", "06-30", "09-30", "12-31"];

/** First quarter-end q with after < q <= upTo, or null. Dates are YYYY-MM-DD. */
export function firstQuarterEndBetween(after: string, upTo: string): string | null {
  for (let year = Number(after.slice(0, 4)); year <= Number(upTo.slice(0, 4)); year++) {
    for (const md of QUARTER_ENDS) {
      const q = `${year}-${md}`;
      if (q > after && q <= upTo) return q;
    }
  }
  return null;
}

// Ace rounds its ratios to 1 dp, which on a small Mcap/Sales (~5x) is ±1%.
// Taking the median implied figure over the last few Ace days of the same
// quarter cancels most of that rounding (backtest: Canara Mcap/Sales worst
// error 1.05% -> 0.60%). Never reaches back past a quarter-end, where Ace's
// TTM figures step.
const ANCHOR_DAYS = 5;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// Ace's TTM figures step ON the quarter-end date (its 30 Sep row already
// uses the new quarter's earnings), so a regime starts at that date.
function lastQuarterEndOnOrBefore(date: string): string {
  const year = Number(date.slice(0, 4));
  const candidates = [`${year - 1}-12-31`, ...QUARTER_ENDS.map((md) => `${year}-${md}`)];
  return candidates.filter((q) => q <= date).at(-1)!;
}

/**
 * `aceRows` are the stored Ace rows, ascending; the last one is the anchor.
 * `prices` must be ascending by date. Each Ace day's close is the latest one
 * on or before it (covers a holiday or a missing price row). A metric with no
 * usable anchor value is left null.
 */
export function computeProvisionalFill(aceRows: ValuationAnchor[], prices: PriceClose[]): ProvisionalFill {
  const anchor = aceRows.at(-1);
  if (!anchor) return { points: [], staleSince: null };
  const later = prices.filter((p) => p.date > anchor.date);
  if (later.length === 0) return { points: [], staleSince: null };

  const closeOnOrBefore = (date: string) => [...prices].reverse().find((p) => p.date <= date)?.priceInr;
  const sameQuarter = aceRows.filter((r) => r.date >= lastQuarterEndOnOrBefore(anchor.date)).slice(-ANCHOR_DAYS);
  const impliedPerShare = (value: (r: ValuationAnchor) => number | null) => {
    const xs = sameQuarter.flatMap((r) => {
      const close = closeOnOrBefore(r.date);
      const v = value(r);
      return close && v && v > 0 ? [close / v] : [];
    });
    return xs.length > 0 ? median(xs) : null;
  };
  const epsTtm = impliedPerShare((r) => r.pe);
  const salesPerShare = impliedPerShare((r) => r.mcapToSales);
  if (epsTtm === null && salesPerShare === null) return { points: [], staleSince: null };

  return {
    points: later.map((p) => ({
      date: p.date,
      pe: epsTtm === null ? null : p.priceInr / epsTtm,
      mcapToSales: salesPerShare === null ? null : p.priceInr / salesPerShare,
      provisional: true,
    })),
    staleSince: firstQuarterEndBetween(anchor.date, later[later.length - 1].date),
  };
}

/**
 * The price-updated days with today's point re-priced at the live share
 * price: the held TTM EPS / sales per share are backed out of the latest
 * earlier provisional day and its stored close, then divided into `live`.
 * Leaves the points alone unless the series ends in provisional days (an
 * Ace file covering today wins) and never rewrites anything after `live`.
 */
export function withLiveValuationPoint<T extends { date: string; pe: number | null; mcapToSales: number | null; provisional?: boolean }>(
  points: T[],
  live: PriceClose | undefined,
  closes: PriceClose[]
): T[] {
  const last = points.at(-1);
  if (!live || !last?.provisional || last.date > live.date) return points;
  const closeOn = new Map(closes.map((c) => [c.date, c.priceInr]));
  const ref = [...points].reverse().find((p) => p.provisional && p.date < live.date && (closeOn.get(p.date) ?? 0) > 0);
  if (!ref) return points;
  const scale = live.priceInr / closeOn.get(ref.date)!;
  const today = {
    ...last,
    date: live.date,
    pe: ref.pe === null ? null : ref.pe * scale,
    mcapToSales: ref.mcapToSales === null ? null : ref.mcapToSales * scale,
    provisional: true,
  };
  return last.date === live.date ? [...points.slice(0, -1), today] : [...points, today];
}
