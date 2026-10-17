import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { getVerdictThresholds, setVerdictThresholds } from "@/lib/aum/fortnightly-update";

// A single GLOBAL setting (not per-AMC) for the Overview card's 5-tier
// Buy/Accumulate/Hold/Reduce/Sell auto-verdict thresholds -- same
// app_settings-backed pattern as /api/sip-industry-estimate-toggle. No
// auth gate, matching this tab's other fields.

export const GET = withErrorHandling(async () => {
  const thresholds = await getVerdictThresholds();
  return NextResponse.json(thresholds);
});

// POST { buyMinPct, accumulateMinPct, holdMinPct, reduceMinPct } -- each a
// finite fraction (e.g. 0.25 for 25%), strictly decreasing in that order.
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const fields = ["buyMinPct", "accumulateMinPct", "holdMinPct", "reduceMinPct"] as const;
  for (const field of fields) {
    if (typeof body?.[field] !== "number" || !Number.isFinite(body[field])) {
      return NextResponse.json({ error: `${field} must be a finite number` }, { status: 400 });
    }
  }
  const thresholds = {
    buyMinPct: body.buyMinPct,
    accumulateMinPct: body.accumulateMinPct,
    holdMinPct: body.holdMinPct,
    reduceMinPct: body.reduceMinPct,
  };
  if (!(thresholds.buyMinPct > thresholds.accumulateMinPct && thresholds.accumulateMinPct > thresholds.holdMinPct && thresholds.holdMinPct > thresholds.reduceMinPct)) {
    return NextResponse.json({ error: "Thresholds must be strictly decreasing: buy > accumulate > hold > reduce" }, { status: 400 });
  }
  await setVerdictThresholds(thresholds);
  return NextResponse.json({ ok: true, thresholds });
});
