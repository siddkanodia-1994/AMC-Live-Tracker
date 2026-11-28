import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { db } from "@/lib/db/client";
import { weeklyReport } from "@/lib/db/schema";

// One weekly report's HTML or PDF (?format=pdf), admin only. Reads just the
// one column asked for.
export const GET = withAdminAuth(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const format = new URL(request.url).searchParams.get("format") === "pdf" ? "pdf" : "html";

  if (format === "pdf") {
    const [row] = await db.select({ weekEnding: weeklyReport.weekEnding, pdf: weeklyReport.pdfBase64 }).from(weeklyReport).where(eq(weeklyReport.id, id));
    if (!row?.pdf) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new Response(new Uint8Array(Buffer.from(row.pdf, "base64")), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="AMC Weekly Update ${row.weekEnding}.pdf"`,
        "cache-control": "no-store",
      },
    });
  }

  const [row] = await db.select({ html: weeklyReport.html }).from(weeklyReport).where(eq(weeklyReport.id, id));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new Response(row.html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The report is static HTML with inline CSS/SVG: no scripts, no network.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      "cache-control": "no-store",
    },
  });
});
