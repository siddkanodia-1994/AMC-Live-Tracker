import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, amcs, appSettings, totalAumGrowthOverrideLog, totalAumGrowthOverrides } from "../db/schema";
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

// The most recent audit-log entry behind an overridden field — lets the UI
// show "Overridden {date} — was {oldValue}" without a per-cell fetch. null
// oldValueCr = the field wasn't overridden before this change (was the
// computed default).
export interface OverrideLastChange {
  oldValueCr: number | null;
  changedAt: string;
}

export interface TotalAumGrowthRow {
  amcId: number;
  slug: string;
  overviewName: string;
  liveAumCr: number | null;
  liveAumAsOfDate: string | null;
  sipInflowCr: number;
  sipInflowIsOverridden: boolean;
  sipInflowLastChange: OverrideLastChange | null;
  reportedAumCr: number;
  reportedAumIsOverridden: boolean;
  reportedAumLastChange: OverrideLastChange | null;
  incomeDebtAumCr: number;
  incomeDebtAumIsOverridden: boolean;
  incomeDebtAumLastChange: OverrideLastChange | null;
  otherFundsAumCr: number;
  otherFundsAumIsOverridden: boolean;
  otherFundsAumLastChange: OverrideLastChange | null;
  totalLiveCr: number | null;
  totalReportedCr: number | null;
  growthPct: number | null;
}

export interface TotalAumGrowthResult {
  currentReportPeriod: string;
  componentReportPeriod: string;
  totalReportedReportPeriod: string;
  availableReportPeriods: string[];
  asOfDate: string;
  minDate: string;
  maxDate: string;
  rows: TotalAumGrowthRow[];
}

interface EffectiveReportedFigures {
  reportedAumCr: number;
  reportedAumIsOverridden: boolean;
  incomeDebtAumCr: number;
  incomeDebtAumIsOverridden: boolean;
  otherFundsAumCr: number;
  otherFundsAumIsOverridden: boolean;
}

/**
 * Resolves every AMC's effective Reported/Income-Debt/Other Funds AUM for
 * ONE report period -- that period's own amc_periods row, with that same
 * period's own total_aum_growth_overrides applied on top. Called twice with
 * potentially different periods: once for whichever period columns 4-6 are
 * showing, and independently again for whichever period Total (Reported) is
 * showing -- the two are user-selectable independently of each other.
 */
async function getEffectiveReportedFigures(reportPeriod: string): Promise<Map<number, EffectiveReportedFigures>> {
  const [periodRows, overrideRows] = await Promise.all([
    db
      .select({
        amcId: amcPeriods.amcId,
        reportedAumCr: amcPeriods.reportedAumCr,
        incomeDebtAumCr: amcPeriods.incomeDebtAumCr,
        otherFundsAumCr: amcPeriods.otherFundsAumCr,
      })
      .from(amcPeriods)
      .where(eq(amcPeriods.reportPeriod, reportPeriod)),
    db.select().from(totalAumGrowthOverrides).where(eq(totalAumGrowthOverrides.reportPeriod, reportPeriod)),
  ]);

  const overrideByAmcId = new Map(overrideRows.map((o) => [o.amcId, o]));
  const map = new Map<number, EffectiveReportedFigures>();
  for (const p of periodRows) {
    const override = overrideByAmcId.get(p.amcId);
    const reportedOverride = override?.reportedAumOverrideCr ?? null;
    const incomeDebtOverride = override?.incomeDebtAumOverrideCr ?? null;
    const otherFundsOverride = override?.otherFundsAumOverrideCr ?? null;
    map.set(p.amcId, {
      reportedAumCr: reportedOverride !== null ? Number(reportedOverride) : Number(p.reportedAumCr),
      reportedAumIsOverridden: reportedOverride !== null,
      incomeDebtAumCr:
        incomeDebtOverride !== null ? Number(incomeDebtOverride) : p.incomeDebtAumCr != null ? Number(p.incomeDebtAumCr) : 0,
      incomeDebtAumIsOverridden: incomeDebtOverride !== null,
      otherFundsAumCr:
        otherFundsOverride !== null ? Number(otherFundsOverride) : p.otherFundsAumCr != null ? Number(p.otherFundsAumCr) : 0,
      otherFundsAumIsOverridden: otherFundsOverride !== null,
    });
  }
  return map;
}

/**
 * Composes the Total AUM Growth tab: each AMC's true total AUM (Growth/Equity
 * + Income/Debt + Other, not just the Growth/Equity slice every other part of
 * this app tracks), combining live-tracked equity AUM as of a picked date
 * with a manually-adjustable flow estimate against a selected month's
 * reported total.
 *
 * Three independent anchors:
 * - `asOfDate` (a real calendar date) drives Live AUM from actual tracked history.
 * - `reportPeriod` ("componentReportPeriod") drives columns 4-6 (Reported,
 *   Income-Debt, Other Funds AUM) and their overrides.
 * - `totalReportedReportPeriod` drives Total (Reported) independently -- its
 *   own effective figures for whatever month it's set to, via the same
 *   override-resolution logic, decoupled from whatever columns 4-6 show.
 * SIP Inflows is anchored to the CURRENT report period always, regardless of
 * either selection above -- both its default (getNetFlowForPeriod) and its
 * override always target currentReportPeriod, by explicit design choice.
 */
export async function getTotalAumGrowth(options?: {
  asOfDate?: string;
  reportPeriod?: string;
  totalReportedReportPeriod?: string;
}): Promise<TotalAumGrowthResult> {
  const currentReportPeriod = await getCurrentReportPeriod();
  const availableReportPeriods = await getAvailableReportPeriods();
  const componentReportPeriod =
    options?.reportPeriod && availableReportPeriods.includes(options.reportPeriod)
      ? options.reportPeriod
      : currentReportPeriod;
  const totalReportedReportPeriod =
    options?.totalReportedReportPeriod && availableReportPeriods.includes(options.totalReportedReportPeriod)
      ? options.totalReportedReportPeriod
      : currentReportPeriod;

  const { minDate, maxDate } = await getCanonicalSnapshotDateBounds();
  if (!minDate || !maxDate) {
    throw new Error("No live AUM history has been captured yet — the daily snapshot cron hasn't run.");
  }
  const asOfDate =
    options?.asOfDate && options.asOfDate >= minDate && options.asOfDate <= maxDate ? options.asOfDate : maxDate;

  const [amcRows, componentFigures, totalReportedFigures, liveAumMap, netFlowMap, sipOverrideRows, overrideLogRows] = await Promise.all([
    db
      .select({ amcId: amcPeriods.amcId, slug: amcs.slug, overviewName: amcs.overviewName })
      .from(amcPeriods)
      .innerJoin(amcs, eq(amcPeriods.amcId, amcs.id))
      .where(eq(amcPeriods.reportPeriod, componentReportPeriod)),
    getEffectiveReportedFigures(componentReportPeriod),
    // Skip the duplicate query when both selections match (the common,
    // default case) -- reuse componentFigures for Total (Reported) too.
    totalReportedReportPeriod === componentReportPeriod ? Promise.resolve(null) : getEffectiveReportedFigures(totalReportedReportPeriod),
    getAllAmcsLiveAumAsOf(asOfDate),
    getNetFlowForPeriod(currentReportPeriod),
    db.select().from(totalAumGrowthOverrides).where(eq(totalAumGrowthOverrides.reportPeriod, currentReportPeriod)),
    // Audit trail for the tooltip on overridden cells -- only the two periods
    // whose overrides are visible here (SIP always lives on the current
    // period; the other three on the component period).
    db
      .select()
      .from(totalAumGrowthOverrideLog)
      .where(inArray(totalAumGrowthOverrideLog.reportPeriod, [...new Set([currentReportPeriod, componentReportPeriod])]))
      .orderBy(desc(totalAumGrowthOverrideLog.changedAt), desc(totalAumGrowthOverrideLog.id)),
  ]);

  const effectiveTotalReportedFigures = totalReportedFigures ?? componentFigures;
  const sipOverrideByAmcId = new Map(sipOverrideRows.map((o) => [o.amcId, o]));

  // Latest log entry per (amcId, period, field) -- rows are already ordered
  // newest-first, so the first one seen wins.
  const lastChangeByKey = new Map<string, OverrideLastChange>();
  for (const log of overrideLogRows) {
    const key = `${log.amcId}|${log.reportPeriod}|${log.field}`;
    if (!lastChangeByKey.has(key)) {
      lastChangeByKey.set(key, {
        oldValueCr: log.oldValueCr !== null ? Number(log.oldValueCr) : null,
        changedAt: log.changedAt.toISOString(),
      });
    }
  }
  const lastChange = (amcId: number, period: string, field: string, isOverridden: boolean) =>
    isOverridden ? (lastChangeByKey.get(`${amcId}|${period}|${field}`) ?? null) : null;

  const rows: TotalAumGrowthRow[] = amcRows.map((amc) => {
    // Guaranteed present: componentFigures was built from the identical
    // amc_periods query (same reportPeriod filter) that produced amcRows.
    const component = componentFigures.get(amc.amcId)!;
    const live = liveAumMap.get(amc.amcId);

    const defaultSipInflowCr = netFlowMap.get(amc.amcId)?.netFlowCr ?? 0;
    const sipOverrideRow = sipOverrideByAmcId.get(amc.amcId);
    const sipOverride = sipOverrideRow?.sipInflowOverrideCr ?? null;
    const sipInflowCr = sipOverride !== null ? Number(sipOverride) : defaultSipInflowCr;

    const liveAumCr = live ? live.liveAumCr : null;
    const totalLiveCr =
      liveAumCr != null ? liveAumCr + sipInflowCr + component.incomeDebtAumCr + component.otherFundsAumCr : null;

    // Independent of `component` above -- an AMC that didn't exist yet (or
    // no longer does) in totalReportedReportPeriod simply has no figure here.
    const totalReportedFigure = effectiveTotalReportedFigures.get(amc.amcId);
    const totalReportedCr = totalReportedFigure
      ? totalReportedFigure.reportedAumCr + totalReportedFigure.incomeDebtAumCr + totalReportedFigure.otherFundsAumCr
      : null;

    const growthPct =
      totalLiveCr != null && totalReportedCr != null && totalReportedCr !== 0 ? totalLiveCr / totalReportedCr - 1 : null;

    return {
      amcId: amc.amcId,
      slug: amc.slug,
      overviewName: amc.overviewName,
      liveAumCr,
      liveAumAsOfDate: live?.snapshotDate ?? null,
      sipInflowCr,
      sipInflowIsOverridden: sipOverride !== null,
      sipInflowLastChange: lastChange(amc.amcId, currentReportPeriod, "sipInflowOverrideCr", sipOverride !== null),
      reportedAumCr: component.reportedAumCr,
      reportedAumIsOverridden: component.reportedAumIsOverridden,
      reportedAumLastChange: lastChange(
        amc.amcId,
        componentReportPeriod,
        "reportedAumOverrideCr",
        component.reportedAumIsOverridden
      ),
      incomeDebtAumCr: component.incomeDebtAumCr,
      incomeDebtAumIsOverridden: component.incomeDebtAumIsOverridden,
      incomeDebtAumLastChange: lastChange(
        amc.amcId,
        componentReportPeriod,
        "incomeDebtAumOverrideCr",
        component.incomeDebtAumIsOverridden
      ),
      otherFundsAumCr: component.otherFundsAumCr,
      otherFundsAumIsOverridden: component.otherFundsAumIsOverridden,
      otherFundsAumLastChange: lastChange(
        amc.amcId,
        componentReportPeriod,
        "otherFundsAumOverrideCr",
        component.otherFundsAumIsOverridden
      ),
      totalLiveCr,
      totalReportedCr,
      growthPct,
    };
  });

  return {
    currentReportPeriod,
    componentReportPeriod,
    totalReportedReportPeriod,
    availableReportPeriods,
    asOfDate,
    minDate,
    maxDate,
    rows,
  };
}
