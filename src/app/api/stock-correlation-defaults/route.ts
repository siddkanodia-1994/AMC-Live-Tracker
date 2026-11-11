import { NextResponse } from "next/server";
import { getStockCorrelationDefaults, sanitizeAumInputs, setStockCorrelationDefaults } from "@/lib/amc-stock/correlation-defaults";
import {
  DEFAULT_WHAT_IF_AUM_DAYS,
  isWhatIfAumDays,
  MAX_AUM_INPUT_CR,
  WHAT_IF_AUM_DAYS_OPTIONS,
} from "@/lib/amc-stock/aum-what-if";
import { RANGE_OPTIONS } from "@/lib/aum/date-range";
import { RATIO_BASIS_OPTIONS } from "@/lib/aum/series-math";
import { EXTRA_LAG_OPTIONS } from "@/lib/amc-stock/regression-engine";
import {
  isBestFitAumPct,
  isValuationAumDays,
  isValuationAvgDays,
  MAX_VALUATION_AVG_DAYS,
  MIN_VALUATION_AVG_DAYS,
  VALUATION_AUM_DAYS_OPTIONS,
} from "@/lib/valuation/valuation-settings";

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
  const levelsCorrelation = body?.levelsCorrelation;
  if (typeof levelsCorrelation !== "boolean") {
    return NextResponse.json({ error: "levelsCorrelation must be a boolean" }, { status: 400 });
  }
  const extraLagDays = Number(body?.extraLagDays);
  if (!EXTRA_LAG_OPTIONS.some((o) => o.value === extraLagDays)) {
    return NextResponse.json({ error: `extraLagDays must be one of ${EXTRA_LAG_OPTIONS.map((o) => o.value).join(", ")}` }, { status: 400 });
  }

  // Optional (older clients omit it). Every entry must be valid -- a
  // partially-bad map is rejected, not silently trimmed.
  const aumInputs = sanitizeAumInputs(body?.aumInputs);
  const sentCount = body?.aumInputs && typeof body.aumInputs === "object" ? Object.keys(body.aumInputs).length : 0;
  if (aumInputs === null || Object.keys(aumInputs).length !== sentCount) {
    return NextResponse.json(
      { error: `aumInputs must map listed AMC slugs to an AUM in ₹ cr between 0 and ${MAX_AUM_INPUT_CR.toLocaleString("en-IN")}` },
      { status: 400 }
    );
  }

  // Optional too (older clients omit it -> the 5-day default).
  const whatIfAumDays = body?.whatIfAumDays ?? DEFAULT_WHAT_IF_AUM_DAYS;
  if (!isWhatIfAumDays(whatIfAumDays)) {
    return NextResponse.json(
      { error: `whatIfAumDays must be one of ${WHAT_IF_AUM_DAYS_OPTIONS.map((o) => o.value).join(", ")}` },
      { status: 400 }
    );
  }

  // The Valuation Model's choices are optional. When a save omits
  // them (the Stock Correlation table's own "Save as default" never sends
  // them), the stored values are kept rather than reset.
  const stored = await getStockCorrelationDefaults();
  const valuationRatioDays = body?.valuationRatioDays ?? stored.valuationRatioDays;
  const bestFitAumDays = body?.bestFitAumDays ?? stored.bestFitAumDays;
  const bestFitAumPct = body?.bestFitAumPct ?? stored.bestFitAumPct;
  const dayChoices = VALUATION_AUM_DAYS_OPTIONS.map((o) => o.value).join(", ");
  if (!isValuationAumDays(valuationRatioDays)) {
    return NextResponse.json({ error: `valuationRatioDays must be one of ${dayChoices}` }, { status: 400 });
  }
  if (!isValuationAumDays(bestFitAumDays)) {
    return NextResponse.json({ error: `bestFitAumDays must be one of ${dayChoices}` }, { status: 400 });
  }
  if (!isBestFitAumPct(bestFitAumPct)) {
    return NextResponse.json({ error: "bestFitAumPct must be a number from 0 to under 100" }, { status: 400 });
  }
  const valuationRatioRange = body?.valuationRatioRange ?? stored.valuationRatioRange;
  const bestFitRange = body?.bestFitRange ?? stored.bestFitRange;
  const valuationRatioHistoryDays = body?.valuationRatioHistoryDays ?? stored.valuationRatioHistoryDays;
  const bestFitMaDays = body?.bestFitMaDays ?? stored.bestFitMaDays;
  const rangeChoices = RANGE_OPTIONS.map((o) => o.value).join(", ");
  if (!RANGE_OPTIONS.some((o) => o.value === valuationRatioRange)) {
    return NextResponse.json({ error: `valuationRatioRange must be one of ${rangeChoices}` }, { status: 400 });
  }
  if (!RANGE_OPTIONS.some((o) => o.value === bestFitRange)) {
    return NextResponse.json({ error: `bestFitRange must be one of ${rangeChoices}` }, { status: 400 });
  }
  const dayRange = `a whole number of days from ${MIN_VALUATION_AVG_DAYS} to ${MAX_VALUATION_AVG_DAYS}`;
  if (!isValuationAvgDays(valuationRatioHistoryDays)) {
    return NextResponse.json({ error: `valuationRatioHistoryDays must be ${dayRange}` }, { status: 400 });
  }
  if (!isValuationAvgDays(bestFitMaDays)) {
    return NextResponse.json({ error: `bestFitMaDays must be ${dayRange}` }, { status: 400 });
  }

  const defaults = {
    range,
    maDays,
    ratioBasis,
    aumOnlyAveraging,
    levelsCorrelation,
    extraLagDays,
    aumInputs,
    whatIfAumDays,
    valuationRatioDays,
    bestFitAumDays,
    bestFitAumPct,
    valuationRatioRange,
    valuationRatioHistoryDays,
    bestFitRange,
    bestFitMaDays,
  };
  await setStockCorrelationDefaults(defaults);
  return NextResponse.json(defaults);
}
