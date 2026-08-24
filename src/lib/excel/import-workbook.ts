import { read, type WorkBook } from "xlsx";
import { and, eq, sql } from "drizzle-orm";
import { transactionalDb } from "../db/transactional-client";
import { amcPeriods, amcs, appSettings, holdings, importLog, officialCceHistory } from "../db/schema";
import { getAmcMap } from "./amc-name-map";
import { assertMapCoversWorkbook } from "./amc-name-map";
import { deriveReportPeriod, parseOverviewSheet } from "./parse-overview";
import { parseAmcSheet } from "./parse-amc-sheet";
import { parseCashHoldingsSheet } from "./parse-cash-holdings";
import type { ImportResult } from "./types";

const CCE_BATCH_SIZE = 500;

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";

export async function importWorkbook(fileBuffer: Buffer, fileName: string): Promise<ImportResult> {
  const wb: WorkBook = read(fileBuffer, { type: "buffer", cellDates: false });

  const overviewRows = parseOverviewSheet(wb);
  const reportPeriod = deriveReportPeriod(wb);
  assertMapCoversWorkbook(wb, overviewRows);

  const overviewByName = new Map(overviewRows.map((r) => [r.overviewName, r]));
  const allWarnings: string[] = [];
  let holdingsImported = 0;
  let amcsImported = 0;
  let cceRowsImported = 0;
  const cashHoldings = parseCashHoldingsSheet(wb);
  allWarnings.push(...cashHoldings.warnings);

  await transactionalDb.transaction(async (tx) => {
    for (const entry of getAmcMap()) {
      const overviewRow = overviewByName.get(entry.overviewName);
      if (!overviewRow) {
        // A mapped AMC with no Overview row in THIS workbook -- expected for
        // a historical (older) import, since a fund that launched later
        // simply didn't exist yet in an earlier month. assertMapCoversWorkbook
        // already guarantees the reverse (every row IN the workbook has a map
        // entry), so this is a legitimate skip, not a data-integrity problem.
        allWarnings.push(`[${entry.overviewName}] Not present in this workbook -- skipped (likely didn't exist yet as of this period).`);
        continue;
      }

      const parsedSheet = parseAmcSheet(wb, entry.sheetName);
      for (const w of parsedSheet.warnings) {
        allWarnings.push(`[${entry.overviewName}] ${w}`);
      }

      if (
        parsedSheet.equityAumHeaderCr != null &&
        Math.abs(parsedSheet.equityAumHeaderCr - overviewRow.reportedAumCr) > 1
      ) {
        allWarnings.push(
          `[${entry.overviewName}] Sheet's equity-AUM header (${parsedSheet.equityAumHeaderCr}) disagrees with Overview's reported AUM (${overviewRow.reportedAumCr}) by more than 1 cr.`
        );
      }

      const residualPlugCr = overviewRow.reportedAumCr - parsedSheet.sheetTotalHoldingsValueCr;

      const incomeDebtAumCr = parsedSheet.incomeDebtAumCr != null ? String(parsedSheet.incomeDebtAumCr) : null;
      const prevIncomeDebtAumCr = parsedSheet.prevIncomeDebtAumCr != null ? String(parsedSheet.prevIncomeDebtAumCr) : null;
      const otherFundsAumCr = parsedSheet.otherFundsAumCr != null ? String(parsedSheet.otherFundsAumCr) : null;
      const prevOtherFundsAumCr = parsedSheet.prevOtherFundsAumCr != null ? String(parsedSheet.prevOtherFundsAumCr) : null;

      const [amcRow] = await tx
        .insert(amcs)
        .values({ slug: entry.slug, overviewName: entry.overviewName, sheetName: entry.sheetName })
        .onConflictDoUpdate({
          target: amcs.slug,
          set: { overviewName: entry.overviewName, sheetName: entry.sheetName },
        })
        .returning();

      await tx
        .insert(amcPeriods)
        .values({
          amcId: amcRow.id,
          reportPeriod,
          reportedAumCr: String(overviewRow.reportedAumCr),
          prevReportedAumCr: String(overviewRow.prevReportedAumCr),
          changeMomPct: String(overviewRow.changeMomPct),
          changeCr: String(overviewRow.changeCr),
          sheetTotalHoldingsValueCr: String(parsedSheet.sheetTotalHoldingsValueCr),
          residualPlugCr: String(residualPlugCr),
          incomeDebtAumCr,
          prevIncomeDebtAumCr,
          otherFundsAumCr,
          prevOtherFundsAumCr,
        })
        .onConflictDoUpdate({
          target: [amcPeriods.amcId, amcPeriods.reportPeriod],
          set: {
            reportedAumCr: String(overviewRow.reportedAumCr),
            prevReportedAumCr: String(overviewRow.prevReportedAumCr),
            changeMomPct: String(overviewRow.changeMomPct),
            changeCr: String(overviewRow.changeCr),
            sheetTotalHoldingsValueCr: String(parsedSheet.sheetTotalHoldingsValueCr),
            residualPlugCr: String(residualPlugCr),
            incomeDebtAumCr,
            prevIncomeDebtAumCr,
            otherFundsAumCr,
            prevOtherFundsAumCr,
            importedAt: new Date(),
          },
        });

      await tx
        .delete(holdings)
        .where(and(eq(holdings.amcId, amcRow.id), eq(holdings.reportPeriod, reportPeriod)));

      if (parsedSheet.holdings.length > 0) {
        await tx.insert(holdings).values(
          parsedSheet.holdings.map((h) => ({
            amcId: amcRow.id,
            reportPeriod,
            companyName: h.companyName,
            sector: h.sector,
            mcapClassification: h.mcapClassification,
            isin: h.isin,
            isPriceable: h.isPriceable,
            marketValueCr: String(h.marketValueCr),
            shares: String(h.shares),
            weightPct: String(h.weightPct),
            prevMarketValueCr: String(h.prevMarketValueCr),
            prevShares: String(h.prevShares),
            prevWeightPct: String(h.prevWeightPct),
            changeMarketValueCr: String(h.changeMarketValueCr),
            changeShares: String(h.changeShares),
            changeWeightPct: String(h.changeWeightPct),
          }))
        );
        holdingsImported += parsedSheet.holdings.length;
      }
      amcsImported++;
    }

    // Cross-check history from the "Cash Holdings" sheet -- keyed by
    // sheetName (e.g. "QSIF"), same identity the rest of this function uses,
    // resolved against every AMC on record (not just ones touched above) so
    // a fund missing from this month's Overview but still present in the
    // sheet's rolling window still resolves correctly.
    if (cashHoldings.rows.length > 0) {
      const allAmcs = await tx.select().from(amcs);
      const sheetNameToAmcId = new Map(allAmcs.map((a) => [a.sheetName.trim().toLowerCase(), a.id]));

      const cceValues: (typeof officialCceHistory.$inferInsert)[] = [];
      const unmatchedSheetNames = new Set<string>();
      for (const row of cashHoldings.rows) {
        const amcId = sheetNameToAmcId.get(row.sheetName.trim().toLowerCase());
        if (!amcId) {
          unmatchedSheetNames.add(row.sheetName);
          continue;
        }
        cceValues.push({ amcId, month: row.month, ccePct: String(row.ccePct) });
      }
      if (unmatchedSheetNames.size > 0) {
        allWarnings.push(
          `[Cash Holdings] ${unmatchedSheetNames.size} row(s) could not be matched to an AMC and were skipped: ${[...unmatchedSheetNames].join(", ")}`
        );
      }

      for (let i = 0; i < cceValues.length; i += CCE_BATCH_SIZE) {
        const batch = cceValues.slice(i, i + CCE_BATCH_SIZE);
        await tx
          .insert(officialCceHistory)
          .values(batch)
          .onConflictDoUpdate({
            target: [officialCceHistory.amcId, officialCceHistory.month],
            set: { ccePct: sql`excluded.cce_pct`, importedAt: sql`now()` },
          });
      }
      cceRowsImported = cceValues.length;
    }

    // Advance the "live" period pointer only forward, never backward — an
    // out-of-order upload (e.g. re-uploading an old month) updates that
    // period's history without regressing which period is considered current.
    const [existing] = await tx
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, CURRENT_REPORT_PERIOD_KEY));

    if (!existing || reportPeriod >= existing.value) {
      await tx
        .insert(appSettings)
        .values({ key: CURRENT_REPORT_PERIOD_KEY, value: reportPeriod })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: reportPeriod, updatedAt: new Date() },
        });
    } else {
      allWarnings.push(
        `Uploaded report period "${reportPeriod}" is older than the current live period "${existing.value}" — that period's history was updated, but the live period pointer was not moved backward.`
      );
    }

    await tx.insert(importLog).values({
      fileName,
      reportPeriod,
      amcsImported,
      holdingsImported,
      warnings: allWarnings,
    });
  });

  return {
    reportPeriod,
    amcsImported,
    holdingsImported,
    cceRowsImported,
    warnings: allWarnings,
  };
}
