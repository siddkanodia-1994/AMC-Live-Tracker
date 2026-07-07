// One-time backfill: derives report period 2026-04 from 2026-05's already-
// imported "prev*" columns (prevMarketValueCr/prevShares/prevWeightPct),
// which are the source Excel's embedded previous-month data for each
// holding. Does NOT touch app_settings.current_report_period -- April is a
// historical period, May remains "current". Safe to re-run (upserts
// amcPeriods, delete+reinserts holdings scoped to amcId+reportPeriod).
import { and, eq } from "drizzle-orm";
import { transactionalDb } from "../src/lib/db/transactional-client";
import { amcPeriods, amcs, holdings } from "../src/lib/db/schema";

const SOURCE_PERIOD = "2026-05";
const TARGET_PERIOD = "2026-04";

async function main() {
  const allAmcs = await transactionalDb.select().from(amcs);
  const mayHoldings = await transactionalDb.select().from(holdings).where(eq(holdings.reportPeriod, SOURCE_PERIOD));
  const mayPeriods = await transactionalDb.select().from(amcPeriods).where(eq(amcPeriods.reportPeriod, SOURCE_PERIOD));
  const mayPeriodByAmcId = new Map(mayPeriods.map((p) => [p.amcId, p]));

  let totalAprilHoldings = 0;
  let totalSkippedNewEntries = 0;

  await transactionalDb.transaction(async (tx) => {
    for (const amc of allAmcs) {
      const mayPeriod = mayPeriodByAmcId.get(amc.id);
      if (!mayPeriod || mayPeriod.prevReportedAumCr === null) {
        console.log(`  skip ${amc.overviewName}: no May period or no prevReportedAumCr`);
        continue;
      }

      const amcMayHoldings = mayHoldings.filter((h) => h.amcId === amc.id);
      // Existence signal is prevMarketValueCr, not prevShares: debt/repo/cash
      // line items (TREPS, Net Current Asset, Call Money, ...) always report
      // shares=0 even when they had a real April value, since "shares" isn't
      // a meaningful concept for them. Filtering on prevShares alone wrongly
      // treated every AMC's real April repo/cash position as a "May-only new
      // entry", folding ~1.29 lakh cr industry-wide into the residual plug
      // instead of showing up as an explicit April holding.
      const aprilHoldingRows = amcMayHoldings
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
      totalSkippedNewEntries += amcMayHoldings.length - aprilHoldingRows.length;

      const sheetTotalHoldingsValueCr = aprilHoldingRows.reduce((sum, h) => sum + Number(h.marketValueCr), 0);
      const aprilReportedAumCr = Number(mayPeriod.prevReportedAumCr);
      const residualPlugCr = aprilReportedAumCr - sheetTotalHoldingsValueCr;
      // May's sheet embeds April's true Income/Debt and Other Funds AUM as its own
      // "prev" values (same technique as prevReportedAumCr above) -- carry them
      // over directly rather than re-deriving anything.
      const aprilIncomeDebtAumCr = mayPeriod.prevIncomeDebtAumCr;
      const aprilOtherFundsAumCr = mayPeriod.prevOtherFundsAumCr;

      await tx
        .insert(amcPeriods)
        .values({
          amcId: amc.id,
          reportPeriod: TARGET_PERIOD,
          reportedAumCr: String(aprilReportedAumCr),
          sheetTotalHoldingsValueCr: String(sheetTotalHoldingsValueCr),
          residualPlugCr: String(residualPlugCr),
          incomeDebtAumCr: aprilIncomeDebtAumCr,
          otherFundsAumCr: aprilOtherFundsAumCr,
        })
        .onConflictDoUpdate({
          target: [amcPeriods.amcId, amcPeriods.reportPeriod],
          set: {
            reportedAumCr: String(aprilReportedAumCr),
            sheetTotalHoldingsValueCr: String(sheetTotalHoldingsValueCr),
            residualPlugCr: String(residualPlugCr),
            incomeDebtAumCr: aprilIncomeDebtAumCr,
            otherFundsAumCr: aprilOtherFundsAumCr,
            importedAt: new Date(),
          },
        });

      await tx.delete(holdings).where(and(eq(holdings.amcId, amc.id), eq(holdings.reportPeriod, TARGET_PERIOD)));

      if (aprilHoldingRows.length > 0) {
        await tx.insert(holdings).values(aprilHoldingRows);
      }

      totalAprilHoldings += aprilHoldingRows.length;
      console.log(
        `  ${amc.overviewName}: ${aprilHoldingRows.length} April holdings, reportedAumCr=${aprilReportedAumCr.toFixed(2)}, residualPlugCr=${residualPlugCr.toFixed(2)}`
      );
    }
  });

  console.log(`\nDone. ${allAmcs.length} AMCs processed, ${totalAprilHoldings} total April holdings rows, ${totalSkippedNewEntries} May-only new entries excluded (correctly not part of April).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
