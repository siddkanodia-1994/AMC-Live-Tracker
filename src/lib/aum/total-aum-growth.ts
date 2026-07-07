import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, amcs, appSettings, totalAumGrowthOverrides } from "../db/schema";
import { getAllAmcsLiveAumAsOf, getCanonicalSnapshotDateBounds, getNetFlowForPeriod } from "./history";

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";

export class NoDataImportedError extends Error {
  constructor() {
    super("No Excel file has been imported yet — upload one from /admin to get started.");
    this.name = "NoDataImportedError";
  }
}

async function getCurrentReportPeriod(): Promise<string> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, CURRENT_REPORT_PERIOD_KEY));
  if (!row) throw new NoDataImportedError();
  return row.value;
}

export interface TotalAumGrowthRow {
  amcId: number;
  slug: string;
  overviewName: string;
  liveAumCr: number | null;
  liveAumAsOfDate: string | null;
  sipInflowCr: number;
  sipInflowIsOverridden: boolean;
  reportedAumCr: number;
  reportedAumIsOverridden: boolean;
  incomeDebtAumCr: number;
  incomeDebtAumIsOverridden: boolean;
  otherFundsAumCr: number;
  otherFundsAumIsOverridden: boolean;
  totalLiveCr: number | null;
  totalReportedCr: number;
  growthPct: number | null;
}

export interface TotalAumGrowthResult {
  reportPeriod: string;
  asOfDate: string;
  minDate: string;
  maxDate: string;
  rows: TotalAumGrowthRow[];
}

/**
 * Composes the Total AUM Growth tab: each AMC's true total AUM (Growth/Equity
 * + Income/Debt + Other, not just the Growth/Equity slice every other part of
 * this app tracks), combining live-tracked equity AUM as of a picked date
 * with a manually-adjustable flow estimate against the last reported total.
 * See total_aum_growth_overrides' schema comment for the override semantics.
 */
export async function getTotalAumGrowth(requestedAsOfDate?: string): Promise<TotalAumGrowthResult> {
  const reportPeriod = await getCurrentReportPeriod();

  const { minDate, maxDate } = await getCanonicalSnapshotDateBounds();
  if (!minDate || !maxDate) {
    throw new Error("No live AUM history has been captured yet — the daily snapshot cron hasn't run.");
  }
  const asOfDate =
    requestedAsOfDate && requestedAsOfDate >= minDate && requestedAsOfDate <= maxDate ? requestedAsOfDate : maxDate;

  const [periodRows, liveAumMap, netFlowMap, overrideRows] = await Promise.all([
    db
      .select({
        amcId: amcPeriods.amcId,
        slug: amcs.slug,
        overviewName: amcs.overviewName,
        reportedAumCr: amcPeriods.reportedAumCr,
        incomeDebtAumCr: amcPeriods.incomeDebtAumCr,
        otherFundsAumCr: amcPeriods.otherFundsAumCr,
      })
      .from(amcPeriods)
      .innerJoin(amcs, eq(amcPeriods.amcId, amcs.id))
      .where(eq(amcPeriods.reportPeriod, reportPeriod)),
    getAllAmcsLiveAumAsOf(asOfDate),
    getNetFlowForPeriod(reportPeriod),
    db.select().from(totalAumGrowthOverrides).where(eq(totalAumGrowthOverrides.reportPeriod, reportPeriod)),
  ]);

  const overrideByAmcId = new Map(overrideRows.map((o) => [o.amcId, o]));

  const rows: TotalAumGrowthRow[] = periodRows.map((p) => {
    const override = overrideByAmcId.get(p.amcId);
    const live = liveAumMap.get(p.amcId);

    const defaultSipInflowCr = netFlowMap.get(p.amcId)?.netFlowCr ?? 0;
    const sipOverride = override?.sipInflowOverrideCr ?? null;
    const sipInflowCr = sipOverride !== null ? Number(sipOverride) : defaultSipInflowCr;

    const defaultReportedAumCr = Number(p.reportedAumCr);
    const reportedOverride = override?.reportedAumOverrideCr ?? null;
    const reportedAumCr = reportedOverride !== null ? Number(reportedOverride) : defaultReportedAumCr;

    const defaultIncomeDebtAumCr = p.incomeDebtAumCr != null ? Number(p.incomeDebtAumCr) : 0;
    const incomeDebtOverride = override?.incomeDebtAumOverrideCr ?? null;
    const incomeDebtAumCr = incomeDebtOverride !== null ? Number(incomeDebtOverride) : defaultIncomeDebtAumCr;

    const defaultOtherFundsAumCr = p.otherFundsAumCr != null ? Number(p.otherFundsAumCr) : 0;
    const otherFundsOverride = override?.otherFundsAumOverrideCr ?? null;
    const otherFundsAumCr = otherFundsOverride !== null ? Number(otherFundsOverride) : defaultOtherFundsAumCr;

    const liveAumCr = live ? live.liveAumCr : null;
    const totalLiveCr = liveAumCr != null ? liveAumCr + sipInflowCr + incomeDebtAumCr + otherFundsAumCr : null;
    const totalReportedCr = reportedAumCr + incomeDebtAumCr + otherFundsAumCr;
    const growthPct = totalLiveCr != null && totalReportedCr !== 0 ? totalLiveCr / totalReportedCr - 1 : null;

    return {
      amcId: p.amcId,
      slug: p.slug,
      overviewName: p.overviewName,
      liveAumCr,
      liveAumAsOfDate: live?.snapshotDate ?? null,
      sipInflowCr,
      sipInflowIsOverridden: sipOverride !== null,
      reportedAumCr,
      reportedAumIsOverridden: reportedOverride !== null,
      incomeDebtAumCr,
      incomeDebtAumIsOverridden: incomeDebtOverride !== null,
      otherFundsAumCr,
      otherFundsAumIsOverridden: otherFundsOverride !== null,
      totalLiveCr,
      totalReportedCr,
      growthPct,
    };
  });

  return { reportPeriod, asOfDate, minDate, maxDate, rows };
}
