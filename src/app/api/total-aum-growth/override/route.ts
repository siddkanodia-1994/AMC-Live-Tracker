import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSettings, totalAumGrowthOverrides } from "@/lib/db/schema";
import { withErrorHandling } from "@/lib/api/with-error-handling";
import { getAvailableReportPeriods } from "@/lib/aum/aum-growth";

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";

/** undefined = field not provided, leave untouched. null = explicitly clear back to default. */
function parseOverrideField(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("Override fields must be a finite number or null");
}

async function upsertOverride(amcId: number, reportPeriod: string, fields: Record<string, string | null>) {
  if (Object.keys(fields).length === 0) return;
  await db
    .insert(totalAumGrowthOverrides)
    .values({ amcId, reportPeriod, ...fields })
    .onConflictDoUpdate({
      target: [totalAumGrowthOverrides.amcId, totalAumGrowthOverrides.reportPeriod],
      set: { ...fields, updatedAt: new Date() },
    });
}

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json();
  const amcId = typeof body?.amcId === "number" ? body.amcId : null;
  if (amcId === null) {
    return NextResponse.json({ error: "amcId is required" }, { status: 400 });
  }

  const sipInflowOverrideCr = parseOverrideField(body?.sipInflowOverrideCr);
  const reportedAumOverrideCr = parseOverrideField(body?.reportedAumOverrideCr);
  const incomeDebtAumOverrideCr = parseOverrideField(body?.incomeDebtAumOverrideCr);
  const otherFundsAumOverrideCr = parseOverrideField(body?.otherFundsAumOverrideCr);

  if (
    sipInflowOverrideCr === undefined &&
    reportedAumOverrideCr === undefined &&
    incomeDebtAumOverrideCr === undefined &&
    otherFundsAumOverrideCr === undefined
  ) {
    return NextResponse.json({ error: "At least one override field is required" }, { status: 400 });
  }

  const [periodRow] = await db.select().from(appSettings).where(eq(appSettings.key, CURRENT_REPORT_PERIOD_KEY));
  if (!periodRow) {
    return NextResponse.json({ error: "No report period configured — import a workbook first." }, { status: 400 });
  }
  const currentReportPeriod = periodRow.value;

  // Reported/Income-Debt/Other AUM target whichever period the client has
  // selected in the dropdown; SIP Inflows always targets the current period
  // regardless -- by design it doesn't follow that selection (see
  // total-aum-growth.ts's doc comment on getTotalAumGrowth).
  let targetReportPeriod = currentReportPeriod;
  if (typeof body?.reportPeriod === "string" && body.reportPeriod !== currentReportPeriod) {
    const availablePeriods = await getAvailableReportPeriods();
    if (availablePeriods.includes(body.reportPeriod)) {
      targetReportPeriod = body.reportPeriod;
    }
  }

  const toDbValue = (v: number | null | undefined) => (v === undefined ? undefined : v === null ? null : String(v));

  const sipFields: Record<string, string | null> = {};
  const sipValue = toDbValue(sipInflowOverrideCr);
  if (sipValue !== undefined) sipFields.sipInflowOverrideCr = sipValue;

  const otherFields: Record<string, string | null> = {};
  const reportedValue = toDbValue(reportedAumOverrideCr);
  const incomeDebtValue = toDbValue(incomeDebtAumOverrideCr);
  const otherFundsValue = toDbValue(otherFundsAumOverrideCr);
  if (reportedValue !== undefined) otherFields.reportedAumOverrideCr = reportedValue;
  if (incomeDebtValue !== undefined) otherFields.incomeDebtAumOverrideCr = incomeDebtValue;
  if (otherFundsValue !== undefined) otherFields.otherFundsAumOverrideCr = otherFundsValue;

  await Promise.all([
    upsertOverride(amcId, currentReportPeriod, sipFields),
    upsertOverride(amcId, targetReportPeriod, otherFields),
  ]);

  return NextResponse.json({ ok: true });
});
