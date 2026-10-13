import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { createFortnightlySnapshot } from "@/lib/aum/fortnightly-update";
import { getIstDateString } from "@/lib/utils/date";

// POST { amcId, asOfDate? } -- creates a new dated snapshot, pre-filled by
// copying forward the most recent prior entry's manual values (or blank if
// this AMC has never had one). asOfDate defaults to today. A no-op
// (onConflictDoNothing) if a snapshot for that exact date already exists --
// never overwrites an existing dated entry.
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const amcId = typeof body?.amcId === "number" ? body.amcId : null;
  if (amcId === null) {
    return NextResponse.json({ error: "amcId is required" }, { status: 400 });
  }
  const asOfDate = typeof body?.asOfDate === "string" ? body.asOfDate : getIstDateString();

  await createFortnightlySnapshot(amcId, asOfDate);
  return NextResponse.json({ ok: true, asOfDate });
});
