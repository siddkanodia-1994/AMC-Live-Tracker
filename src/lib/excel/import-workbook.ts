import { read, type WorkBook } from "xlsx";
import { and, eq } from "drizzle-orm";
import { transactionalDb } from "../db/transactional-client";
import { amcPeriods, amcs, appSettings, holdings, importLog } from "../db/schema";
import { getAmcMap } from "./amc-name-map";
import { assertMapCoversWorkbook } from "./amc-name-map";
import { deriveReportPeriod, parseOverviewSheet } from "./parse-overview";
import { parseAmcSheet } from "./parse-amc-sheet";
import type { ImportResult } from "./types";

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";

export async function importWorkbook(fileBuffer: Buffer, fileName: string): Promise<ImportResult> {
  const wb: WorkBook = read(fileBuffer, { type: "buffer", cellDates: false });

  const overviewRows = parseOverviewSheet(wb);
  const reportPeriod = deriveReportPeriod(wb);
  assertMapCoversWorkbook(wb, overviewRows);

  const overviewByName = new Map(overviewRows.map((r) => [r.overviewName, r]));
  const allWarnings: string[] = [];
  let holdingsImported = 0;

  await transactionalDb.transaction(async (tx) => {
    for (const entry of getAmcMap()) {
      const overviewRow = overviewByName.get(entry.overviewName);
      if (!overviewRow) {
        // assertMapCoversWorkbook already guarantees this can't happen, but keep
        // the invariant explicit rather than silently skipping.
        throw new Error(`[import] No Overview row found for mapped AMC "${entry.overviewName}"`);
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
      amcsImported: getAmcMap().length,
      holdingsImported,
      warnings: allWarnings,
    });
  });

  return {
    reportPeriod,
    amcsImported: getAmcMap().length,
    holdingsImported,
    warnings: allWarnings,
  };
}
