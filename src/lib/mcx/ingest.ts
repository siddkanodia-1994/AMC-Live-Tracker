import { db } from "../db/client";
import { mcxDailyPrice, mcxTrackedContract } from "../db/schema";
import { fetchHistoricalCloses } from "../dhan/historical-client";
import { getPreviousFiscalQuarterBounds } from "../aum/report-period";
import { addDaysToDateString, getIstDateString } from "../utils/date";

export interface McxIngestResult {
  contractsTracked: number;
  rowsUpserted: number;
  warnings: string[];
}

const EXPIRY_WARNING_WINDOW_DAYS = 14;

/**
 * Daily ingestion for the MCX Gold/Silver reference rows on the Gold &
 * Silver ETFs tab -- entirely independent of both the TigZig-based ETF
 * pipeline and DHAN's equity pipeline (its own isolated try/catch in the
 * daily cron), so a failure here can't affect either.
 *
 * Unlike etfDailyNav (which only ever fetches "today's" NAV), this always
 * re-fetches the whole [previous fiscal quarter start, today] window in
 * one request per metal and upserts every row -- DHAN's historical/charts
 * endpoint returns a full date range in a single call, so this is just 2
 * requests/day total, and re-upserting ~60-90 unchanged historical rows
 * daily is negligible at this scale. This also means there's no separate
 * "quarter rollover" step to get wrong: once a new fiscal quarter starts,
 * the fetched window simply shifts forward on its own the next time this
 * runs, and both quarters' averages (computed on the fly by
 * src/lib/mcx/compute.ts) are always fresh.
 */
export async function runMcxIngestion(): Promise<McxIngestResult> {
  const contracts = await db.select().from(mcxTrackedContract);
  const warnings: string[] = [];

  if (contracts.length === 0) {
    return { contractsTracked: 0, rowsUpserted: 0, warnings: ["No MCX contracts registered yet — run scripts/seed-mcx-contracts.ts."] };
  }

  const today = getIstDateString();
  const { start: fromDate } = getPreviousFiscalQuarterBounds(today);

  let rowsUpserted = 0;
  for (const contract of contracts) {
    const closes = await fetchHistoricalCloses(contract.securityId, "MCX_COMM", fromDate, today, "FUTCOM");
    if (closes.length === 0) {
      warnings.push(`[${contract.metal}] No MCX price data returned for ${contract.tradingSymbol} (${fromDate} to ${today}).`);
    }
    for (const { date, close } of closes) {
      await db
        .insert(mcxDailyPrice)
        .values({ metal: contract.metal, snapshotDate: date, priceInr: String(close), securityId: contract.securityId })
        .onConflictDoUpdate({
          target: [mcxDailyPrice.metal, mcxDailyPrice.snapshotDate],
          set: { priceInr: String(close), securityId: contract.securityId, computedAt: new Date() },
        });
      rowsUpserted++;
    }

    if (contract.expiryDate <= addDaysToDateString(today, EXPIRY_WARNING_WINDOW_DAYS)) {
      warnings.push(
        `[${contract.metal}] Tracked contract ${contract.tradingSymbol} expires ${contract.expiryDate} — re-run scripts/seed-mcx-contracts.ts with the next contract soon.`
      );
    }
  }

  return { contractsTracked: contracts.length, rowsUpserted, warnings };
}
