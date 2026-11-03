import { NextResponse } from "next/server";
import { desc, gte } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { db } from "@/lib/db/client";
import { opsRunLog } from "@/lib/db/schema";

// Read-only feed for the Admin page's Agent Ops panel: the most recent
// ops_run_log rows (cron steps, probe checks, agent outcomes), bounded to
// 30 days and 200 rows so it stays a small, cheap read.
export const GET = withAdminAuth(async () => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(opsRunLog).where(gte(opsRunLog.createdAt, since)).orderBy(desc(opsRunLog.createdAt)).limit(200);
  return NextResponse.json({ rows });
});
