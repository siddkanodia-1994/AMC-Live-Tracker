import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/with-admin-auth";
import { upsertMonthlyFlow } from "@/lib/aum/industry-flows";

const MONTH_END_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const POST = withAdminAuth(async (request: Request) => {
  const body = await request.json().catch(() => null);
  const monthEndDate = String(body?.monthEndDate ?? "");
  const sipContributionsCr = Number(body?.sipContributionsCr);
  const equityNetFlowsCr = Number(body?.equityNetFlowsCr);

  if (!MONTH_END_DATE_RE.test(monthEndDate)) {
    return NextResponse.json({ error: "monthEndDate must be an ISO date (YYYY-MM-DD)" }, { status: 400 });
  }
  if (!Number.isFinite(sipContributionsCr) || !Number.isFinite(equityNetFlowsCr)) {
    return NextResponse.json({ error: "sipContributionsCr and equityNetFlowsCr must be numbers" }, { status: 400 });
  }

  await upsertMonthlyFlow(monthEndDate, sipContributionsCr, equityNetFlowsCr);
  return NextResponse.json({
    monthEndDate,
    sipContributionsCr,
    equityNetFlowsCr,
    equityBulkFlowsCr: equityNetFlowsCr - sipContributionsCr,
  });
});
