import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { AMC_ANALYTICS_NUMBER_FIELDS, getAmcAnalyticsInputs, isAmcAnalyticsField, saveAmcAnalyticsField } from "@/lib/aum/amc-analytics-inputs";

// AMC Analytics' figures shared with the Fortnightly tab (each AMC's latest
// snapshot row): GET ?amcId=, POST { amcId, field, value }. Saves always go
// to the AMC's latest row, chosen here at save time. No auth gate, like the
// Fortnightly route it mirrors.
export const GET = withErrorHandling(async (request: Request) => {
  const amcId = Number(new URL(request.url).searchParams.get("amcId"));
  if (!Number.isInteger(amcId)) return NextResponse.json({ error: "amcId is required" }, { status: 400 });
  const inputs = await getAmcAnalyticsInputs(amcId);
  if (!inputs) return NextResponse.json({ error: "Unknown amcId" }, { status: 404 });
  return NextResponse.json(inputs);
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const amcId = typeof body?.amcId === "number" && Number.isInteger(body.amcId) ? body.amcId : null;
  const field = typeof body?.field === "string" ? body.field : null;
  if (amcId === null || field === null) return NextResponse.json({ error: "amcId and field are required" }, { status: 400 });
  if (!isAmcAnalyticsField(field)) {
    return NextResponse.json({ error: `field must be amcScoreAnchorDate or one of ${AMC_ANALYTICS_NUMBER_FIELDS.join(", ")}` }, { status: 400 });
  }
  const raw = body?.value;
  let value: number | string | null;
  if (raw === null) value = null;
  else if (field === "amcScoreAnchorDate") {
    if (typeof raw !== "string" || !DATE_PATTERN.test(raw)) return NextResponse.json({ error: "amcScoreAnchorDate must be YYYY-MM-DD or null" }, { status: 400 });
    value = raw;
  } else if (typeof raw === "number" && Number.isFinite(raw)) value = raw;
  else return NextResponse.json({ error: "value must be a finite number or null" }, { status: 400 });

  const asOfDate = await saveAmcAnalyticsField(amcId, field, value);
  return NextResponse.json({ ok: true, asOfDate });
});
