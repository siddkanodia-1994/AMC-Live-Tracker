import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import {
  getFortnightlySheet,
  saveFortnightlyField,
  MANUAL_FIELD_NAMES,
  type FortnightlyFieldName,
} from "@/lib/aum/fortnightly-update";

export const GET = withErrorHandling(async (request: Request) => {
  const url = new URL(request.url);
  const amcId = Number(url.searchParams.get("amcId"));
  if (!Number.isFinite(amcId)) {
    return NextResponse.json({ error: "amcId is required" }, { status: 400 });
  }
  const asOfDate = url.searchParams.get("asOfDate") ?? undefined;
  const includeFlowEstimate = url.searchParams.get("includeFlowEstimate") === "true";

  const sheet = await getFortnightlySheet(amcId, asOfDate, includeFlowEstimate);
  if (!sheet) {
    return NextResponse.json({ error: "Unknown amcId" }, { status: 404 });
  }
  return NextResponse.json(sheet);
});

// POST { amcId, asOfDate, field, value: number | null } -- saves one manual
// cell, same per-field upsert shape as the net-flow override route. No
// auth gate, per the user's explicit choice for this feature.
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json();
  const amcId = typeof body?.amcId === "number" ? body.amcId : null;
  const asOfDate = typeof body?.asOfDate === "string" ? body.asOfDate : null;
  const field = typeof body?.field === "string" ? (body.field as FortnightlyFieldName) : null;

  if (amcId === null || asOfDate === null || field === null) {
    return NextResponse.json({ error: "amcId, asOfDate, and field are required" }, { status: 400 });
  }
  if (!(MANUAL_FIELD_NAMES as readonly string[]).includes(field)) {
    return NextResponse.json({ error: `Unknown field: ${field}` }, { status: 400 });
  }

  const rawValue = body?.value;
  let value: number | null;
  if (rawValue === null) {
    value = null;
  } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    value = rawValue;
  } else {
    return NextResponse.json({ error: "value must be a finite number or null" }, { status: 400 });
  }

  await saveFortnightlyField(amcId, asOfDate, field, value);
  return NextResponse.json({ ok: true });
});
