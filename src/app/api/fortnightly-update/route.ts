import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import {
  getFortnightlySheet,
  saveFortnightlyField,
  MANUAL_FIELD_NAMES,
  VERDICT_TIERS,
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

// Every manual field is a plain number except amcScoreAnchorDate (a
// YYYY-MM-DD date string, picked from a dropdown of real amc_scores
// snapshot dates -- see src/lib/aum/amc-score.ts) -- the only date-typed
// field in this table today.
const DATE_FIELD_NAMES: readonly string[] = ["amcScoreAnchorDate"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The Overview card's text fields -- summary is free-form (length-capped
// so an unbounded paste can't bloat the row); verdictOverride is enum-
// checked against the 5-tier scale plus the literal "custom" sentinel;
// verdictCustomText is free-form but capped short (same cap the UI's own
// input enforces), since it's meant to be a pill-sized label, not a note.
const SUMMARY_MAX_LENGTH = 4000;
const VERDICT_CUSTOM_TEXT_MAX_LENGTH = 40;

// POST { amcId, asOfDate, field, value: number | string | null } -- saves
// one manual cell, same per-field upsert shape as the net-flow override
// route. No auth gate, per the user's explicit choice for this feature.
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
  let value: number | string | null;
  if (rawValue === null) {
    value = null;
  } else if (field === "summary") {
    if (typeof rawValue !== "string") {
      return NextResponse.json({ error: "summary must be a string or null" }, { status: 400 });
    }
    if (rawValue.length > SUMMARY_MAX_LENGTH) {
      return NextResponse.json({ error: `summary must be ${SUMMARY_MAX_LENGTH} characters or fewer` }, { status: 400 });
    }
    value = rawValue;
  } else if (field === "verdictOverride") {
    if (typeof rawValue !== "string" || (!(VERDICT_TIERS as readonly string[]).includes(rawValue) && rawValue !== "custom")) {
      return NextResponse.json(
        { error: `verdictOverride must be one of ${VERDICT_TIERS.join(", ")}, "custom", or null` },
        { status: 400 }
      );
    }
    value = rawValue;
  } else if (field === "verdictCustomText") {
    if (typeof rawValue !== "string") {
      return NextResponse.json({ error: "verdictCustomText must be a string or null" }, { status: 400 });
    }
    if (rawValue.length > VERDICT_CUSTOM_TEXT_MAX_LENGTH) {
      return NextResponse.json({ error: `verdictCustomText must be ${VERDICT_CUSTOM_TEXT_MAX_LENGTH} characters or fewer` }, { status: 400 });
    }
    value = rawValue;
  } else if (DATE_FIELD_NAMES.includes(field)) {
    if (typeof rawValue !== "string" || !DATE_PATTERN.test(rawValue)) {
      return NextResponse.json({ error: `${field} must be a YYYY-MM-DD date string or null` }, { status: 400 });
    }
    value = rawValue;
  } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    value = rawValue;
  } else {
    return NextResponse.json({ error: "value must be a finite number or null" }, { status: 400 });
  }

  await saveFortnightlyField(amcId, asOfDate, field, value);
  return NextResponse.json({ ok: true });
});
