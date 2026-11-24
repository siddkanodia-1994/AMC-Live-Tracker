import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { saveValuationEstimate } from "@/lib/valuation/estimate-store";
import { isTargetFy, MAX_TARGET_FY, MIN_TARGET_FY } from "@/lib/valuation/target-year";

// AMC Analytics' Valuation Model: one year's PAT or revenue for one AMC,
// POST { amcId, fiscalYear, kind: "pat" | "revenue", value }. FY26–FY28
// figures land on the AMC's latest Fortnightly row, as the Fortnightly tab's
// own cells do; later years in amc_valuation_estimate. Reads come with
// GET /api/amc-analytics/inputs. No auth gate, like that route.
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const amcId = typeof body?.amcId === "number" && Number.isInteger(body.amcId) ? body.amcId : null;
  if (amcId === null) return NextResponse.json({ error: "amcId is required" }, { status: 400 });
  const fiscalYear = body?.fiscalYear;
  if (!isTargetFy(fiscalYear)) {
    return NextResponse.json({ error: `fiscalYear must be a whole year from ${MIN_TARGET_FY} to ${MAX_TARGET_FY}` }, { status: 400 });
  }
  const kind = body?.kind;
  if (kind !== "pat" && kind !== "revenue") return NextResponse.json({ error: 'kind must be "pat" or "revenue"' }, { status: 400 });
  const value = body?.value;
  if (value !== null && !(typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e12)) {
    return NextResponse.json({ error: "value must be a non-negative number (₹ Cr) or null" }, { status: 400 });
  }
  await saveValuationEstimate(amcId, fiscalYear, kind, value);
  return NextResponse.json({ ok: true });
});
