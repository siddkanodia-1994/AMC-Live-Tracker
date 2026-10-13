import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { amcListedStock, amcManualNetFlow, amcManualNetFlowLog } from "@/lib/db/schema";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { getAvailableReportPeriods } from "@/lib/aum/aum-growth";
import { invalidateLiveAumCache } from "@/lib/aum/cache";

// GET ?reportPeriod=2026-08 -> which AMCs get the editable column at all
// (listedStockAmcIds) plus the current manual net flow overrides for that
// period, keyed by amcId -- powers the Equity AUM Growth tab's "Manual Net
// Flow" column (which rows are eligible, which cells already have a saved
// value). Single source of truth for "eligible" so the client never has to
// duplicate the amc_listed_stock join itself.
export const GET = withErrorHandling(async (request: Request) => {
  const url = new URL(request.url);
  const reportPeriod = url.searchParams.get("reportPeriod");
  if (!reportPeriod) {
    return NextResponse.json({ error: "reportPeriod is required" }, { status: 400 });
  }

  const [listedStockRows, overrideRows] = await Promise.all([
    db.select({ amcId: amcListedStock.amcId }).from(amcListedStock),
    db.select().from(amcManualNetFlow).where(eq(amcManualNetFlow.reportPeriod, reportPeriod)),
  ]);

  const overrides: Record<number, { netFlowOverrideCr: number; updatedAt: string }> = {};
  for (const r of overrideRows) {
    if (r.netFlowOverrideCr !== null) {
      overrides[r.amcId] = { netFlowOverrideCr: Number(r.netFlowOverrideCr), updatedAt: r.updatedAt.toISOString() };
    }
  }
  return NextResponse.json({
    reportPeriod,
    listedStockAmcIds: listedStockRows.map((r) => r.amcId),
    overrides,
  });
});

// POST { amcId, reportPeriod, netFlowOverrideCr: number | null } -- always
// editable, re-saving overwrites; null resets back to the calculated
// figure. No auth gate, same precedent as /api/total-aum-growth/override
// and /api/live-aum/mute-stock. Scoped to the amc_listed_stock AMCs only
// (the 8 whose own disclosures this feature exists for) -- rejected
// otherwise, even though the UI never offers the input for anyone else.
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json();
  const amcId = typeof body?.amcId === "number" ? body.amcId : null;
  const reportPeriod = typeof body?.reportPeriod === "string" ? body.reportPeriod : null;
  if (amcId === null || reportPeriod === null) {
    return NextResponse.json({ error: "amcId and reportPeriod are required" }, { status: 400 });
  }

  const rawValue = body?.netFlowOverrideCr;
  let netFlowOverrideCr: number | null;
  if (rawValue === null) {
    netFlowOverrideCr = null;
  } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    netFlowOverrideCr = rawValue;
  } else {
    return NextResponse.json({ error: "netFlowOverrideCr must be a finite number or null" }, { status: 400 });
  }

  const [listedStock] = await db.select().from(amcListedStock).where(eq(amcListedStock.amcId, amcId));
  if (!listedStock) {
    return NextResponse.json({ error: "Manual net flow is only available for amc_listed_stock AMCs" }, { status: 400 });
  }

  const availablePeriods = await getAvailableReportPeriods();
  if (!availablePeriods.includes(reportPeriod)) {
    return NextResponse.json({ error: `Unknown report period: ${reportPeriod}` }, { status: 400 });
  }

  const newValue = netFlowOverrideCr === null ? null : String(netFlowOverrideCr);

  const [existing] = await db
    .select()
    .from(amcManualNetFlow)
    .where(and(eq(amcManualNetFlow.amcId, amcId), eq(amcManualNetFlow.reportPeriod, reportPeriod)));
  const oldValue = existing?.netFlowOverrideCr ?? null;
  const changed = oldValue === null || newValue === null ? oldValue !== newValue : Number(oldValue) !== Number(newValue);

  await db
    .insert(amcManualNetFlow)
    .values({ amcId, reportPeriod, netFlowOverrideCr: newValue })
    .onConflictDoUpdate({
      target: [amcManualNetFlow.amcId, amcManualNetFlow.reportPeriod],
      set: { netFlowOverrideCr: newValue, updatedAt: new Date() },
    });

  if (changed) {
    await db.insert(amcManualNetFlowLog).values({ amcId, reportPeriod, oldValueCr: oldValue, newValueCr: newValue });
    // Same reasoning as mute-stock/dismiss-last-close: without this, the
    // Overview table and AMC detail page keep serving computeLiveAum's
    // in-memory cached result (up to OFF_HOURS_CACHE_TTL_MS stale) and the
    // override wouldn't show up until that cache naturally expired.
    invalidateLiveAumCache();
  }

  return NextResponse.json({ ok: true, amcId, reportPeriod, netFlowOverrideCr });
});
