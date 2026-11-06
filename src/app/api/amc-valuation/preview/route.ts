import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { previewValuationUpload, validateValuationRows } from "@/lib/valuation/store";

// POST { rows } -- what an upload WOULD change (new dates, revised dates,
// sample of old -> new values). Writes nothing.
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json();
  const { rows, error } = validateValuationRows(body?.rows);
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json(await previewValuationUpload(rows));
});
