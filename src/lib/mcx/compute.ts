import { and, avg, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/client";
import { mcxDailyPrice } from "../db/schema";
import { getFiscalQuarterBounds, getPreviousFiscalQuarterBounds } from "../aum/report-period";
import { getIstDateString } from "../utils/date";

export interface McxReferenceRow {
  metal: "gold" | "silver";
  displayName: string;
  unit: string; // "10g" | "kg"
  prevQuarterAvgPriceInr: number | null;
  currentQuarterAvgPriceInr: number | null;
  deltaPct: number | null;
}

const METALS: { metal: "gold" | "silver"; displayName: string; unit: string }[] = [
  { metal: "gold", displayName: "MCX Gold", unit: "10g" },
  { metal: "silver", displayName: "MCX Silver", unit: "kg" },
];

/**
 * Avg MCX price for one metal over [startDate, endDate] -- mirrors
 * getAverageAumForRange (src/lib/aum/history.ts) and
 * getAverageIndexLevelForRange (src/lib/aum/index-benchmarks.ts). No
 * stored per-quarter baseline the way etfPeriodAum is for ETFs: this
 * average is entirely self-computed from mcx_daily_price, not an
 * external authority's own disclosed figure, so it's simpler and always
 * fresh to compute on the fly rather than capture-and-store.
 */
async function getAverageMcxPriceForRange(metal: string, startDate: string, endDate: string): Promise<number | null> {
  const [row] = await db
    .select({ avgPrice: avg(mcxDailyPrice.priceInr) })
    .from(mcxDailyPrice)
    .where(and(eq(mcxDailyPrice.metal, metal), gte(mcxDailyPrice.snapshotDate, startDate), lte(mcxDailyPrice.snapshotDate, endDate)));
  return row?.avgPrice != null ? Number(row.avgPrice) : null;
}

/**
 * The two MCX reference rows for the Gold & Silver ETFs tab: each metal's
 * average price over the previous fiscal quarter vs the current fiscal
 * quarter to date, and the % change between them. This is a genuinely
 * different calculation from the ETF schemes' own point-to-point NAV
 * return (liveNav / navAtPeriodEnd - 1) -- an avg-to-avg ratio, per the
 * user's explicit choice -- so it's a directional cross-check, not an
 * exactly matched comparison. See the UI's tooltip on these rows.
 */
export async function getMcxReferenceRows(): Promise<McxReferenceRow[]> {
  const today = getIstDateString();
  const { start: prevStart, end: prevEnd } = getPreviousFiscalQuarterBounds(today);
  const { start: currentStart } = getFiscalQuarterBounds(today);

  const rows: McxReferenceRow[] = [];
  for (const { metal, displayName, unit } of METALS) {
    const prevQuarterAvgPriceInr = await getAverageMcxPriceForRange(metal, prevStart, prevEnd);
    const currentQuarterAvgPriceInr = await getAverageMcxPriceForRange(metal, currentStart, today);
    const deltaPct =
      prevQuarterAvgPriceInr !== null && currentQuarterAvgPriceInr !== null && prevQuarterAvgPriceInr !== 0
        ? currentQuarterAvgPriceInr / prevQuarterAvgPriceInr - 1
        : null;
    rows.push({ metal, displayName, unit, prevQuarterAvgPriceInr, currentQuarterAvgPriceInr, deltaPct });
  }
  return rows;
}
