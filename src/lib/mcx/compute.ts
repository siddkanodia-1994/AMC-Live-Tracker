import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "../db/client";
import { mcxDailyPrice } from "../db/schema";
import { getPreviousFiscalQuarterBounds } from "../aum/report-period";
import { getIstDateString } from "../utils/date";

export interface McxReferenceRow {
  metal: "gold" | "silver";
  displayName: string;
  unit: string; // "10g" | "kg"
  quarterEndPriceInr: number | null;
  livePriceInr: number | null;
  deltaPct: number | null;
}

const METALS: { metal: "gold" | "silver"; displayName: string; unit: string }[] = [
  { metal: "gold", displayName: "MCX Gold", unit: "10g" },
  { metal: "silver", displayName: "MCX Silver", unit: "kg" },
];

/**
 * The metal's own price as of the closest trading day on/before `date` --
 * mirrors getIndexLevelsAsOf (src/lib/aum/index-benchmarks.ts) exactly.
 */
async function getMcxPriceAsOf(metal: string, date: string): Promise<number | null> {
  const [row] = await db
    .select({ priceInr: mcxDailyPrice.priceInr })
    .from(mcxDailyPrice)
    .where(and(eq(mcxDailyPrice.metal, metal), lte(mcxDailyPrice.snapshotDate, date)))
    .orderBy(desc(mcxDailyPrice.snapshotDate))
    .limit(1);
  return row ? Number(row.priceInr) : null;
}

/**
 * The two MCX reference rows for the Gold & Silver ETFs tab: each metal's
 * own price as of the previous fiscal quarter's end vs its latest
 * available price, and the % change between them -- deliberately the
 * same point-to-point shape as the ETF schemes' own return
 * (liveNav / navAtPeriodEnd - 1), and anchored to the SAME quarter-end
 * date (the ETF side's navAtPeriodEnd date), so this is a genuinely
 * well-matched comparison, not just a directional one. (An earlier
 * version averaged daily closes across each quarter instead -- real data
 * showed that could diverge sharply, even in sign, from both this
 * point-to-point figure and the ETF's own return whenever a quarter had
 * a volatility spike or was still partial; switched per explicit
 * confirmation after that surfaced.)
 */
export async function getMcxReferenceRows(): Promise<McxReferenceRow[]> {
  const today = getIstDateString();
  const { end: quarterEndDate } = getPreviousFiscalQuarterBounds(today);

  const rows: McxReferenceRow[] = [];
  for (const { metal, displayName, unit } of METALS) {
    const quarterEndPriceInr = await getMcxPriceAsOf(metal, quarterEndDate);
    const livePriceInr = await getMcxPriceAsOf(metal, today);
    const deltaPct =
      quarterEndPriceInr !== null && livePriceInr !== null && quarterEndPriceInr !== 0
        ? livePriceInr / quarterEndPriceInr - 1
        : null;
    rows.push({ metal, displayName, unit, quarterEndPriceInr, livePriceInr, deltaPct });
  }
  return rows;
}
