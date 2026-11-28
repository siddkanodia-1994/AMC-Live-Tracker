import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { buildWeeklyReportData, figureProblems } from "@/lib/reports/weekly/compute";
import { renderWeeklyReportHtml } from "@/lib/reports/weekly/render";
import { loadWeeklyReportInputs } from "@/lib/reports/weekly/server-inputs";
import { getIstDateString } from "@/lib/utils/date";

export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// /admin's "Generate report now": the weekly report's figures, tables and
// charts computed from the live database for ?asOf (default today; the last
// trading day on or before it is used). Read-only and nothing is stored;
// the written commentary comes only from the Saturday run.
export const GET = withAdminAuth(async (request: Request) => {
  const asOfParam = new URL(request.url).searchParams.get("asOf");
  if (asOfParam !== null && (!DATE_RE.test(asOfParam) || Number.isNaN(Date.parse(`${asOfParam}T00:00:00Z`)))) {
    return NextResponse.json({ error: "asOf must be YYYY-MM-DD" }, { status: 400 });
  }
  const requested = asOfParam ?? getIstDateString();
  const data = buildWeeklyReportData(await loadWeeklyReportInputs(requested), requested, new Date().toISOString());
  const html = renderWeeklyReportHtml(data, null, { onDemand: { problems: figureProblems(data) } });
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The report is static HTML with inline CSS/SVG: no scripts, no network.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      "cache-control": "no-store",
    },
  });
});
