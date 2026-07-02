import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { syncInstrumentMap } from "@/lib/dhan/instrument-master";
import { invalidateLiveAumCache } from "@/lib/aum/cache";

export const maxDuration = 60;

export const POST = withErrorHandling(async () => {
  const result = await syncInstrumentMap();
  invalidateLiveAumCache();
  return NextResponse.json(result);
});
