import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { db } from "@/lib/db/client";
import { importLog } from "@/lib/db/schema";

// Feeds the Admin page's auto-reclaim status banner -- the most recent
// import overall, regardless of whether it triggered a reclaim
// (reclaimStatus is null when it didn't, e.g. a same/older-period re-upload).
export const GET = withAdminAuth(async () => {
  const [latest] = await db.select().from(importLog).orderBy(desc(importLog.id)).limit(1);
  return NextResponse.json(latest ?? null);
});
