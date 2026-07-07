// One-time backfill: derives report period 2026-02 from 2026-03's already-
// imported "prev*" columns (prevMarketValueCr/prevShares/prevWeightPct),
// which are the source Excel's embedded previous-month data for each
// holding -- same technique as materialize-april-period.ts (which derived
// 2026-04 from 2026-05's prev* columns). Does NOT touch
// app_settings.current_report_period -- February is a historical period,
// May remains "current". Safe to re-run (upserts amcPeriods, delete+reinserts
// holdings scoped to amcId+reportPeriod).
import { and, eq } from "drizzle-orm";
import { transactionalDb } from "../src/lib/db/transactional-client";
import { amcPeriods, amcs, holdings } from "../src/lib/db/schema";

const SOURCE_PERIOD = "2026-03";
const TARGET_PERIOD = "2026-02";

async function main() {
  const allAmcs = await transactionalDb.select().from(amcs);
  const marchHoldings = await transactionalDb.select().from(holdings).where(eq(holdings.reportPeriod, SOURCE_PERIOD));
  const marchPeriods = await transactionalDb.select().from(amcPeriods).where(eq(amcPeriods.reportPeriod, SOURCE_PERIOD));
  const marchPeriodByAmcId = new Map(marchPeriods.map((p) => [p.amcId, p]));

  let totalFebHoldings = 0;
  let totalSkippedNewEntries = 0;

  await transactionalDb.transaction(async (tx) => {
    for (const amc of allAmcs) {
      const marchPeriod = marchPeriodByAmcId.get(amc.id);
      if (!marchPeriod || marchPeriod.prevReportedAumCr === null) {
        console.log(`  skip ${amc.overviewName}: no March period or no prevReportedAumCr (didn't exist yet as of Feb/March)`);
        continue;
      }

      const amcMarchHoldings = marchHoldings.filter((h) => h.amcId === amc.id);
      // Existence signal is prevMarketValueCr, not prevShares -- debt/repo/cash
      // line items (TREPS, Net Current Asset, Call Money, ...) always report
      // shares=0 even when they had a real February value, since "shares"
      // isn't a meaningful concept for them (same reasoning as the April
      // script, which fixed an industry-wide misattribution from this exact
      // mistake).
      const febHoldingRows = amcMarchHoldings
        .filter((h) => h.prevMarketValueCr !== null && Number(h.prevMarketValueCr) !== 0)
        .map((h) => ({
          amcId: amc.id,
          reportPeriod: TARGET_PERIOD,
          companyName: h.companyName,
          sector: h.sector,
          mcapClassification: h.mcapClassification,
          isin: h.isin,
          isPriceable: h.isPriceable,
          marketValueCr: String(h.prevMarketValueCr),
          shares: String(h.prevShares),
          weightPct: h.prevWeightPct !== null ? String(h.prevWeightPct) : "0",
        }));
      totalSkippedNewEntries += amcMarchHoldings.length - febHoldingRows.length;

      const sheetTotalHoldingsValueCr = febHoldingRows.reduce((sum, h) => sum + Number(h.marketValueCr), 0);
      const febReportedAumCr = Number(marchPeriod.prevReportedAumCr);
      const residualPlugCr = febReportedAumCr - sheetTotalHoldingsValueCr;
      // March's sheet embeds Feb's true Income/Debt and Other Funds AUM as its own
      // "prev" values (same technique as prevReportedAumCr above) -- carry them
      // over directly rather than re-deriving anything.
      const febIncomeDebtAumCr = marchPeriod.prevIncomeDebtAumCr;
      const febOtherFundsAumCr = marchPeriod.prevOtherFundsAumCr;

      await tx
        .insert(amcPeriods)
        .values({
          amcId: amc.id,
          reportPeriod: TARGET_PERIOD,
          reportedAumCr: String(febReportedAumCr),
          sheetTotalHoldingsValueCr: String(sheetTotalHoldingsValueCr),
          residualPlugCr: String(residualPlugCr),
          incomeDebtAumCr: febIncomeDebtAumCr,
          otherFundsAumCr: febOtherFundsAumCr,
        })
        .onConflictDoUpdate({
          target: [amcPeriods.amcId, amcPeriods.reportPeriod],
          set: {
            reportedAumCr: String(febReportedAumCr),
            sheetTotalHoldingsValueCr: String(sheetTotalHoldingsValueCr),
            residualPlugCr: String(residualPlugCr),
            incomeDebtAumCr: febIncomeDebtAumCr,
            otherFundsAumCr: febOtherFundsAumCr,
            importedAt: new Date(),
          },
        });

      await tx.delete(holdings).where(and(eq(holdings.amcId, amc.id), eq(holdings.reportPeriod, TARGET_PERIOD)));

      if (febHoldingRows.length > 0) {
        await tx.insert(holdings).values(febHoldingRows);
      }

      totalFebHoldings += febHoldingRows.length;
      console.log(
        `  ${amc.overviewName}: ${febHoldingRows.length} February holdings, reportedAumCr=${febReportedAumCr.toFixed(2)}, residualPlugCr=${residualPlugCr.toFixed(2)}`
      );
    }
  });

  console.log(`\nDone. ${marchPeriodByAmcId.size} AMCs processed, ${totalFebHoldings} total February holdings rows, ${totalSkippedNewEntries} March-only new entries excluded (correctly not part of February).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
