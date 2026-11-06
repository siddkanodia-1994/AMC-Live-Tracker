import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { applyValuationUpload, validateValuationRows } from "@/lib/valuation/store";

// Writing ~10k rows in batches can take a while on a first full load.
export const maxDuration = 120;

// POST { rows, sourceFile } -- re-diffs server-side, inserts new dates,
// overwrites changed ones (logging old -> new), never deletes. No auth
// gate, same as the dashboard's other edit controls (the user's choice).
export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json();
  const { rows, error } = validateValuationRows(body?.rows);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const sourceFile = typeof body?.sourceFile === "string" && body.sourceFile.trim() ? body.sourceFile.trim().slice(0, 200) : "upload";
  return NextResponse.json(await applyValuationUpload(rows, sourceFile));
});
