import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { db } from "@/lib/db/client";
import { weeklyReport } from "@/lib/db/schema";
import { parseWeeklyReportUpload } from "@/lib/reports/weekly/upload";

// The Saturday AMC Weekly Update, admin only. GET lists the weeks without
// ever reading the report bodies (sizes come from octet_length, so a list
// is a few hundred bytes of egress); POST is `agent-cli report publish`.
export const GET = withAdminAuth(async () => {
  const reports = await db
    .select({
      id: weeklyReport.id,
      weekEnding: weeklyReport.weekEnding,
      asOfDate: weeklyReport.asOfDate,
      createdAt: weeklyReport.createdAt,
      updatedAt: weeklyReport.updatedAt,
      htmlBytes: sql<number>`octet_length(${weeklyReport.html})`.mapWith(Number),
      pdfBytes: sql<number | null>`(octet_length(${weeklyReport.pdfBase64}) * 3 / 4)`.mapWith(Number),
      checkVerdict: sql<string | null>`${weeklyReport.commentary} -> 'check' ->> 'verdict'`,
    })
    .from(weeklyReport)
    .orderBy(desc(weeklyReport.weekEnding))
    .limit(104);
  return NextResponse.json({ reports });
});

export const POST = withAdminAuth(async (request: Request) => {
  const parsed = parseWeeklyReportUpload(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;
  const [row] = await db
    .insert(weeklyReport)
    .values(v)
    .onConflictDoUpdate({
      target: weeklyReport.weekEnding,
      set: { asOfDate: v.asOfDate, html: v.html, pdfBase64: v.pdfBase64, figures: v.figures, commentary: v.commentary, updatedAt: new Date() },
    })
    .returning({ id: weeklyReport.id, weekEnding: weeklyReport.weekEnding });
  return NextResponse.json(row);
});
