import { and, eq, inArray, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { db } from "@/lib/db/client";
import { appSettings, holdings, isinShareAdjustment } from "@/lib/db/schema";

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";

// Lists currently-active (non-dismissed) share adjustments for the current
// report period -- what's actually affecting live pricing right now. Feeds
// the Admin page's "reverse a wrong detection" panel.
export const GET = withAdminAuth(async () => {
  const [periodRow] = await db.select().from(appSettings).where(eq(appSettings.key, CURRENT_REPORT_PERIOD_KEY));
  if (!periodRow) return NextResponse.json({ adjustments: [] });
  const reportPeriod = periodRow.value;

  const rows = await db
    .select()
    .from(isinShareAdjustment)
    .where(and(eq(isinShareAdjustment.reportPeriod, reportPeriod), isNull(isinShareAdjustment.dismissedAt)));

  if (rows.length === 0) return NextResponse.json({ adjustments: [] });

  const isins = rows.map((r) => r.isin);
  const holdingRows = await db
    .selectDistinctOn([holdings.isin], { isin: holdings.isin, companyName: holdings.companyName })
    .from(holdings)
    .where(and(eq(holdings.reportPeriod, reportPeriod), inArray(holdings.isin, isins)));
  const companyNameByIsin = new Map(holdingRows.map((h) => [h.isin as string, h.companyName]));

  const adjustments = rows
    .map((r) => ({
      isin: r.isin,
      reportPeriod: r.reportPeriod,
      companyName: companyNameByIsin.get(r.isin) ?? r.isin,
      effectiveMultiplier: Number(r.effectiveMultiplier),
      firstDetectedOn: r.firstDetectedOn,
      lastDetectedOn: r.lastDetectedOn,
      detectionCount: r.detectionCount,
      lastPriceBeforeInr: Number(r.lastPriceBeforeInr),
      lastPriceAfterInr: Number(r.lastPriceAfterInr),
    }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));

  return NextResponse.json({ adjustments });
});
