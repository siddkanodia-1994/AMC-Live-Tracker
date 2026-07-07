import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSettings, holdings, instrumentMap } from "@/lib/db/schema";
import { getDhanClientIdStatus, getDhanTokenStatus } from "@/lib/dhan/token";

export async function GET() {
  try {
    const [periodRow] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "current_report_period"));

    const [{ count: instrumentCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(instrumentMap);

    const [{ count: priceableCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(holdings)
      .where(eq(holdings.isPriceable, true));

    const [{ count: mappedPriceableCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(holdings)
      .innerJoin(instrumentMap, eq(holdings.isin, instrumentMap.isin))
      .where(eq(holdings.isPriceable, true));

    const [tokenStatus, clientIdStatus] = await Promise.all([getDhanTokenStatus(), getDhanClientIdStatus()]);

    return NextResponse.json({
      db: "ok",
      currentReportPeriod: periodRow?.value ?? null,
      instrumentMapCount: instrumentCount,
      priceableHoldingsCount: priceableCount,
      mappedPriceableHoldingsCount: mappedPriceableCount,
      dhanToken: tokenStatus,
      dhanClientId: clientIdStatus,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ db: "error", error: "Health check failed" }, { status: 500 });
  }
}
