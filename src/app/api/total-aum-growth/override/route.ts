import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { appSettings, totalAumGrowthOverrides } from "@/lib/db/schema";
import { withErrorHandling } from "@/lib/api/with-error-handling";

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";

/** undefined = field not provided, leave untouched. null = explicitly clear back to default. */
function parseOverrideField(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error("Override fields must be a finite number or null");
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
  const reportPeriod = periodRow.value;

  const toDbValue = (v: number | null | undefined) => (v === undefined ? undefined : v === null ? null : String(v));

  const values = {
    amcId,
    reportPeriod,
    sipInflowOverrideCr: toDbValue(sipInflowOverrideCr),
    reportedAumOverrideCr: toDbValue(reportedAumOverrideCr),
    incomeDebtAumOverrideCr: toDbValue(incomeDebtAumOverrideCr),
    otherFundsAumOverrideCr: toDbValue(otherFundsAumOverrideCr),
  };

  const setValues: Record<string, string | null | Date> = { updatedAt: new Date() };
  if (values.sipInflowOverrideCr !== undefined) setValues.sipInflowOverrideCr = values.sipInflowOverrideCr;
  if (values.reportedAumOverrideCr !== undefined) setValues.reportedAumOverrideCr = values.reportedAumOverrideCr;
  if (values.incomeDebtAumOverrideCr !== undefined) setValues.incomeDebtAumOverrideCr = values.incomeDebtAumOverrideCr;
  if (values.otherFundsAumOverrideCr !== undefined) setValues.otherFundsAumOverrideCr = values.otherFundsAumOverrideCr;

  await db
    .insert(totalAumGrowthOverrides)
    .values(values)
    .onConflictDoUpdate({
      target: [totalAumGrowthOverrides.amcId, totalAumGrowthOverrides.reportPeriod],
      set: setValues,
    });

  return NextResponse.json({ ok: true });
});
