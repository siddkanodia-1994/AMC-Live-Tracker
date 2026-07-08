import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, amcs, appSettings, totalAumGrowthOverrides } from "../db/schema";
import { getAvailableReportPeriods } from "./aum-growth";
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
  currentReportPeriod: string;
  selectedReportPeriod: string;
  availableReportPeriods: string[];
  asOfDate: string;
  minDate: string;
  maxDate: string;
  rows: TotalAumGrowthRow[];
}

/**
 * Composes the Total AUM Growth tab: each AMC's true total AUM (Growth/Equity
 * + Income/Debt + Other, not just the Growth/Equity slice every other part of
 * this app tracks), combining live-tracked equity AUM as of a picked date
 * with a manually-adjustable flow estimate against a selected month's
 * reported total. See total_aum_growth_overrides' schema comment for the
 * override semantics.
 *
 * Two independent anchors: `asOfDate` (a real calendar date, drives Live AUM
 * from actual tracked history) and `reportPeriod` (a report month, drives
 * Reported/Income-Debt/Other AUM and their overrides). SIP Inflows is
 * anchored to the CURRENT report period always, regardless of which
 * `reportPeriod` is selected for the other three -- both its default
 * (getNetFlowForPeriod) and its override always target currentReportPeriod,
 * by explicit design choice, not an oversight.
 */
export async function getTotalAumGrowth(options?: {
  asOfDate?: string;
  reportPeriod?: string;
}): Promise<TotalAumGrowthResult> {
  const currentReportPeriod = await getCurrentReportPeriod();
  const availableReportPeriods = await getAvailableReportPeriods();
  const selectedReportPeriod =
    options?.reportPeriod && availableReportPeriods.includes(options.reportPeriod)
      ? options.reportPeriod
      : currentReportPeriod;

  const { minDate, maxDate } = await getCanonicalSnapshotDateBounds();
  if (!minDate || !maxDate) {
    throw new Error("No live AUM history has been captured yet — the daily snapshot cron hasn't run.");
  }
  const asOfDate =
    options?.asOfDate && options.asOfDate >= minDate && options.asOfDate <= maxDate ? options.asOfDate : maxDate;

  const overridePeriods = Array.from(new Set([currentReportPeriod, selectedReportPeriod]));

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
      .where(eq(amcPeriods.reportPeriod, selectedReportPeriod)),
    getAllAmcsLiveAumAsOf(asOfDate),
    getNetFlowForPeriod(currentReportPeriod),
    db.select().from(totalAumGrowthOverrides).where(inArray(totalAumGrowthOverrides.reportPeriod, overridePeriods)),
  ]);

  // SIP Inflow overrides always come from the currentReportPeriod row; the
  // other three fields always come from the selectedReportPeriod row -- these
  // coincide (the common case) when nothing but the current month is selected.
  const sipOverrideByAmcId = new Map(
    overrideRows.filter((o) => o.reportPeriod === currentReportPeriod).map((o) => [o.amcId, o])
  );
  const otherOverridesByAmcId = new Map(
    overrideRows.filter((o) => o.reportPeriod === selectedReportPeriod).map((o) => [o.amcId, o])
  );

  const rows: TotalAumGrowthRow[] = periodRows.map((p) => {
    const sipOverrideRow = sipOverrideByAmcId.get(p.amcId);
    const otherOverrideRow = otherOverridesByAmcId.get(p.amcId);
    const live = liveAumMap.get(p.amcId);

    const defaultSipInflowCr = netFlowMap.get(p.amcId)?.netFlowCr ?? 0;
    const sipOverride = sipOverrideRow?.sipInflowOverrideCr ?? null;
    const sipInflowCr = sipOverride !== null ? Number(sipOverride) : defaultSipInflowCr;

    const defaultReportedAumCr = Number(p.reportedAumCr);
    const reportedOverride = otherOverrideRow?.reportedAumOverrideCr ?? null;
    const reportedAumCr = reportedOverride !== null ? Number(reportedOverride) : defaultReportedAumCr;

    const defaultIncomeDebtAumCr = p.incomeDebtAumCr != null ? Number(p.incomeDebtAumCr) : 0;
    const incomeDebtOverride = otherOverrideRow?.incomeDebtAumOverrideCr ?? null;
    const incomeDebtAumCr = incomeDebtOverride !== null ? Number(incomeDebtOverride) : defaultIncomeDebtAumCr;

    const defaultOtherFundsAumCr = p.otherFundsAumCr != null ? Number(p.otherFundsAumCr) : 0;
    const otherFundsOverride = otherOverrideRow?.otherFundsAumOverrideCr ?? null;
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

  return { currentReportPeriod, selectedReportPeriod, availableReportPeriods, asOfDate, minDate, maxDate, rows };
}
