import { NextResponse, after } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { importWorkbook } from "@/lib/excel/import-workbook";
import { invalidateLiveAumCache } from "@/lib/aum/cache";
import { runPostImportReclaim } from "@/lib/aum/reclaim-forward-gap";

// Matches reclaim-forward-gap/route.ts's own budget: when this import
// genuinely advances current_report_period, the after() callback below runs
// the same instrument-sync + backfill work in the background (measured
// ~65-70s there), governed by this same maxDuration.
export const maxDuration = 300;

export const POST = withAdminAuth(async (request: Request) => {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected a multipart 'file' field" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await importWorkbook(buffer, file.name);

  invalidateLiveAumCache();

  // Only a genuine new-period advance has a forward gap to reclaim -- a
  // same/older-period re-upload (e.g. correcting a data error in a past
  // month) skips this, matching reclaimForwardGap()'s own "nothing to
  // reclaim" semantics for that case, without even calling it.
  if (result.advancedToNewPeriod) {
    after(() => runPostImportReclaim(result.importLogId));
  }

  return NextResponse.json(result);
});
