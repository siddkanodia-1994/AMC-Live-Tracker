import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { syncInstrumentMap } from "@/lib/dhan/instrument-master";
import { invalidateLiveAumCache } from "@/lib/aum/cache";

export const maxDuration = 60;

export const POST = withAdminAuth(async () => {
  const result = await syncInstrumentMap();
  invalidateLiveAumCache();
  return NextResponse.json(result);
});
