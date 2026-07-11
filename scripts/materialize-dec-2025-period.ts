// One-time backfill: derives report period 2025-12 from 2026-01's already-
// imported "prev*" columns (prevMarketValueCr/prevShares/prevWeightPct),
// which are the source Excel's embedded previous-month data for each
// holding -- same technique as materialize-feb-period.ts (which derived
// 2026-02 from 2026-03's prev* columns). Does NOT touch
// app_settings.current_report_period -- December is a historical period,
// May remains "current". Safe to re-run (upserts amcPeriods, delete+reinserts
// holdings scoped to amcId+reportPeriod).
import { and, eq } from "drizzle-orm";
import { transactionalDb } from "../src/lib/db/transactional-client";
import { amcPeriods, amcs, holdings } from "../src/lib/db/schema";

const SOURCE_PERIOD = "2026-01";
const TARGET_PERIOD = "2025-12";

async function main() {
  const allAmcs = await transactionalDb.select().from(amcs);
  const janHoldings = await transactionalDb.select().from(holdings).where(eq(holdings.reportPeriod, SOURCE_PERIOD));
  const janPeriods = await transactionalDb.select().from(amcPeriods).where(eq(amcPeriods.reportPeriod, SOURCE_PERIOD));
  const janPeriodByAmcId = new Map(janPeriods.map((p) => [p.amcId, p]));

  let totalDecHoldings = 0;
  let totalSkippedNewEntries = 0;

  await transactionalDb.transaction(async (tx) => {
    for (const amc of allAmcs) {
      const janPeriod = janPeriodByAmcId.get(amc.id);
      if (!janPeriod || janPeriod.prevReportedAumCr === null) {
        console.log(`  skip ${amc.overviewName}: no January period or no prevReportedAumCr (didn't exist yet as of Dec/Jan)`);
        continue;
      }

      const amcJanHoldings = janHoldings.filter((h) => h.amcId === amc.id);
      // Existence signal is prevMarketValueCr, not prevShares -- debt/repo/cash
      // line items (TREPS, Net Current Asset, Call Money, ...) always report
      // shares=0 even when they had a real December value, since "shares"
      // isn't a meaningful concept for them (same reasoning as the Feb/April
      // scripts, which fixed an industry-wide misattribution from this exact
      // mistake).
      const decHoldingRows = amcJanHoldings
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
      totalSkippedNewEntries += amcJanHoldings.length - decHoldingRows.length;

      const sheetTotalHoldingsValueCr = decHoldingRows.reduce((sum, h) => sum + Number(h.marketValueCr), 0);
      const decReportedAumCr = Number(janPeriod.prevReportedAumCr);
      const residualPlugCr = decReportedAumCr - sheetTotalHoldingsValueCr;
      // January's sheet embeds December's true Income/Debt and Other Funds AUM as its own
      // "prev" values (same technique as prevReportedAumCr above) -- carry them
      // over directly rather than re-deriving anything.
      const decIncomeDebtAumCr = janPeriod.prevIncomeDebtAumCr;
      const decOtherFundsAumCr = janPeriod.prevOtherFundsAumCr;

      await tx
        .insert(amcPeriods)
        .values({
          amcId: amc.id,
          reportPeriod: TARGET_PERIOD,
          reportedAumCr: String(decReportedAumCr),
          sheetTotalHoldingsValueCr: String(sheetTotalHoldingsValueCr),
          residualPlugCr: String(residualPlugCr),
          incomeDebtAumCr: decIncomeDebtAumCr,
          otherFundsAumCr: decOtherFundsAumCr,
        })
        .onConflictDoUpdate({
          target: [amcPeriods.amcId, amcPeriods.reportPeriod],
          set: {
            reportedAumCr: String(decReportedAumCr),
            sheetTotalHoldingsValueCr: String(sheetTotalHoldingsValueCr),
            residualPlugCr: String(residualPlugCr),
            incomeDebtAumCr: decIncomeDebtAumCr,
            otherFundsAumCr: decOtherFundsAumCr,
            importedAt: new Date(),
          },
        });

      await tx.delete(holdings).where(and(eq(holdings.amcId, amc.id), eq(holdings.reportPeriod, TARGET_PERIOD)));

      if (decHoldingRows.length > 0) {
        await tx.insert(holdings).values(decHoldingRows);
      }

      totalDecHoldings += decHoldingRows.length;
      console.log(
        `  ${amc.overviewName}: ${decHoldingRows.length} December holdings, reportedAumCr=${decReportedAumCr.toFixed(2)}, residualPlugCr=${residualPlugCr.toFixed(2)}`
      );
    }
  });

  console.log(`\nDone. ${janPeriodByAmcId.size} AMCs processed, ${totalDecHoldings} total December holdings rows, ${totalSkippedNewEntries} January-only new entries excluded (correctly not part of December).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
