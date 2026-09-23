import { NextResponse } from "next/server";
import { getStockCorrelationDefaults, setStockCorrelationDefaults } from "@/lib/amc-stock/correlation-defaults";
import { RANGE_OPTIONS } from "@/lib/aum/date-range";
import { RATIO_BASIS_OPTIONS } from "@/lib/aum/series-math";

// Deliberately NOT wrapped in withAdminAuth -- unlike every other global
// app-wide setting in this codebase, saving the Stock Correlation tab's
// default view is open to any visitor, per explicit product decision.
export async function GET() {
  const defaults = await getStockCorrelationDefaults();
  return NextResponse.json(defaults);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  const range = body?.range;
  if (!RANGE_OPTIONS.some((o) => o.value === range)) {
    return NextResponse.json({ error: `range must be one of ${RANGE_OPTIONS.map((o) => o.value).join(", ")}` }, { status: 400 });
  }
  const maDays = Number(body?.maDays);
  if (!Number.isFinite(maDays) || maDays < 0) {
    return NextResponse.json({ error: "maDays must be a non-negative number" }, { status: 400 });
  }
  const ratioBasis = body?.ratioBasis;
  if (!RATIO_BASIS_OPTIONS.some((o) => o.value === ratioBasis)) {
    return NextResponse.json(
      { error: `ratioBasis must be one of ${RATIO_BASIS_OPTIONS.map((o) => o.value).join(", ")}` },
      { status: 400 }
    );
  }
  const aumOnlyAveraging = body?.aumOnlyAveraging;
  if (typeof aumOnlyAveraging !== "boolean") {
    return NextResponse.json({ error: "aumOnlyAveraging must be a boolean" }, { status: 400 });
  }

  const defaults = { range, maDays, ratioBasis, aumOnlyAveraging };
  await setStockCorrelationDefaults(defaults);
  return NextResponse.json(defaults);
}
