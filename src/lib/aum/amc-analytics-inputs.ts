// AMC Analytics' own read and save path for the figures it shares with the
// Fortnightly AMC Update tab (valuation inputs, the AMC SIP card, industry
// SIP overrides, the AMC Score anchor). Same stored data -- each AMC's
// latest amc_fortnightly_update row -- but only the columns AMC Analytics
// shows, without the sheet's AUM / MTM / ratio / price work, and saves
// always land on the AMC's latest row (picked here, at save time).

import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { amcFortnightlyUpdate, amcs } from "../db/schema";
import { getIstDateString } from "../utils/date";
import { getAmcScoreForOverviewName, type AmcScoreCard } from "./amc-score";
import { getFiscalYearAndQuarter } from "./report-period";
import {
  getSipAmcPeriodLabels,
  getSipIndustryAutoValues,
  getSipIndustryQuarterlyAutoValues,
  type SipIndustryAuto,
  type SipIndustryQuarterlyAuto,
  type SipPeriodLabels,
} from "./sip-industry-settings";
import { saveSnapshotFieldWithHistory } from "./sip-quarterly";

/** The numeric cells AMC Analytics reads and edits (same names as the Fortnightly fields). */
export const AMC_ANALYTICS_NUMBER_FIELDS = [
  "noOfSharesCr",
  "patFy26aCr",
  "patFy27eCr",
  "patFy28eCr",
  "targetPeBear",
  "targetPeBase",
  "targetPeBull",
  "discountRateFy27Pct",
  "discountRateFy26Pct",
  "revenueFy28eCr",
  "targetMcapSalesBear",
  "targetMcapSalesBase",
  "targetMcapSalesBull",
  "sipAmcQtdValCr",
  "sipAmcQtdPct",
  "sipAmcPrevQValCr",
  "sipAmcPrevQPct",
  "sipAmcPrevQ2ValCr",
  "sipAmcPrevQ2Pct",
  "sipAmcYoyQValCr",
  "sipAmcYoyQPct",
  "sipAmcYoyQ2ValCr",
  "sipAmcYoyQ2Pct",
  "sipAmcLatestFy",
  "sipAmcLatestQuarter",
  "sipIndustryMtdValCr",
  "sipIndustryPrevMValCr",
  "sipIndustryPrevM2ValCr",
  "sipIndustryYoyMValCr",
  "sipIndustryYoyM2ValCr",
  "sipIndustryQtrQtdValCr",
  "sipIndustryQtrPrevQValCr",
  "sipIndustryQtrPrevQ2ValCr",
  "sipIndustryQtrYoyQValCr",
  "sipIndustryQtrYoyQ2ValCr",
] as const;

export type AmcAnalyticsNumberField = (typeof AMC_ANALYTICS_NUMBER_FIELDS)[number];
export type AmcAnalyticsField = AmcAnalyticsNumberField | "amcScoreAnchorDate";
export type AmcAnalyticsManual = Record<AmcAnalyticsNumberField, number | null> & { amcScoreAnchorDate: string | null };

export function isAmcAnalyticsField(field: string): field is AmcAnalyticsField {
  return field === "amcScoreAnchorDate" || (AMC_ANALYTICS_NUMBER_FIELDS as readonly string[]).includes(field);
}

export interface AmcAnalyticsInputs {
  amcId: number;
  slug: string;
  /** The snapshot row these came from (each AMC's latest). */
  asOfDate: string;
  manual: AmcAnalyticsManual;
  sipAmcLabels: SipPeriodLabels;
  sipAmcLatestFy: number;
  sipAmcLatestQuarter: number;
  sipIndustryAuto: SipIndustryAuto | null;
  sipIndustryQuarterlyAuto: SipIndustryQuarterlyAuto | null;
}

const columns = Object.fromEntries(AMC_ANALYTICS_NUMBER_FIELDS.map((f) => [f, amcFortnightlyUpdate[f]])) as {
  [K in AmcAnalyticsNumberField]: (typeof amcFortnightlyUpdate)[K];
};

async function latestRow(amcId: number) {
  const [row] = await db
    .select({ asOfDate: amcFortnightlyUpdate.asOfDate, amcScoreAnchorDate: amcFortnightlyUpdate.amcScoreAnchorDate, ...columns })
    .from(amcFortnightlyUpdate)
    .where(eq(amcFortnightlyUpdate.amcId, amcId))
    .orderBy(desc(amcFortnightlyUpdate.asOfDate))
    .limit(1);
  return row ?? null;
}

/** One AMC's inputs from its latest snapshot row; null for an unknown AMC. */
export async function getAmcAnalyticsInputs(amcId: number): Promise<AmcAnalyticsInputs | null> {
  const [[amc], row, sipIndustryAuto, sipIndustryQuarterlyAuto] = await Promise.all([
    db.select({ id: amcs.id, slug: amcs.slug }).from(amcs).where(eq(amcs.id, amcId)),
    latestRow(amcId),
    getSipIndustryAutoValues(),
    getSipIndustryQuarterlyAutoValues(),
  ]);
  if (!amc) return null;
  const asOfDate = row?.asOfDate ?? getIstDateString();
  const manual = Object.fromEntries(
    AMC_ANALYTICS_NUMBER_FIELDS.map((f) => [f, row?.[f] == null ? null : Number(row[f])])
  ) as AmcAnalyticsManual;
  manual.amcScoreAnchorDate = row?.amcScoreAnchorDate ?? null;
  // Same default as the Fortnightly sheet: the snapshot date's own quarter.
  const fallback = getFiscalYearAndQuarter(asOfDate);
  const sipAmcLatestFy = manual.sipAmcLatestFy ?? fallback.fy;
  const sipAmcLatestQuarter = manual.sipAmcLatestQuarter ?? fallback.q;
  return {
    amcId,
    slug: amc.slug,
    asOfDate,
    manual,
    sipAmcLabels: getSipAmcPeriodLabels(sipAmcLatestFy, sipAmcLatestQuarter),
    sipAmcLatestFy,
    sipAmcLatestQuarter,
    sipIndustryAuto,
    sipIndustryQuarterlyAuto,
  };
}

/** The AMC Score card (the external AMC Score project) at the AMC's saved anchor. */
export async function getAmcAnalyticsScore(amcId: number): Promise<{ card: AmcScoreCard | null; availableDates: string[] } | null> {
  const [[amc], row] = await Promise.all([
    db.select({ overviewName: amcs.overviewName }).from(amcs).where(eq(amcs.id, amcId)),
    latestRow(amcId),
  ]);
  if (!amc) return null;
  return getAmcScoreForOverviewName(amc.overviewName, row?.amcScoreAnchorDate ?? null);
}

/** Save one cell on the AMC's latest snapshot row (SIP card figures also into their quarter's history). */
export async function saveAmcAnalyticsField(amcId: number, field: AmcAnalyticsField, value: number | string | null): Promise<string> {
  const row = await latestRow(amcId);
  const asOfDate = row?.asOfDate ?? getIstDateString();
  await saveSnapshotFieldWithHistory(amcId, asOfDate, field, value);
  return asOfDate;
}
