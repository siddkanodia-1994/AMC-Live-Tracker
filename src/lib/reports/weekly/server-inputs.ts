// The weekly report's inputs read straight from the database, for the
// /admin "Generate report now" button: the same functions the public GET
// routes call (listed AMCs, correlations, AUM range, target year, flows,
// SIP matrix, per-AMC inputs / valuation / score), passed through JSON so
// the figures are identical to the CLI run that fetches those routes.

import { eq } from "drizzle-orm";
import { getAmcStockCorrelationData } from "../../amc-stock/correlation-summary";
import { getAmcAnalyticsInputs, getAmcAnalyticsScore } from "../../aum/amc-analytics-inputs";
import { getAumHistoryRangeAllAmcs } from "../../aum/history";
import { getAllMonthlyFlows } from "../../aum/industry-flows";
import { getFiscalQuarterBounds } from "../../aum/report-period";
import { getSipQuarterlyMatrix } from "../../aum/sip-quarterly";
import { db } from "../../db/client";
import { amcListedStock, amcs } from "../../db/schema";
import { addDaysToDateString } from "../../utils/date";
import { getValuationTargetFy } from "../../valuation/estimate-store";
import { getAmcValuationSeries } from "../../valuation/store";
import type { RawReportInputs } from "./types";

const NIPPON = "nippon-india-mutual-fund";

/** As a GET response would deliver it: dates as strings, no class instances. */
function asJson<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function loadWeeklyReportInputs(requestedAsOf: string): Promise<RawReportInputs> {
  const listed = await db
    .select({ id: amcs.id, slug: amcs.slug, overviewName: amcs.overviewName })
    .from(amcListedStock)
    .innerJoin(amcs, eq(amcListedStock.amcId, amcs.id))
    .orderBy(amcs.overviewName);
  const nippon = listed.find((a) => a.slug === NIPPON);
  const rangeFrom = addDaysToDateString(getFiscalQuarterBounds(requestedAsOf).start, -460);

  // Everything in parallel: the route has 60 s, and each query is a round trip.
  const [correlations, range, targetFy, flows, sip, perAmcRows] = await Promise.all([
    getAmcStockCorrelationData(nippon ? [nippon.id] : undefined),
    getAumHistoryRangeAllAmcs(rangeFrom, requestedAsOf),
    getValuationTargetFy(),
    getAllMonthlyFlows(),
    getSipQuarterlyMatrix(),
    Promise.all(
      listed.map(async (a) => {
        const [inputs, valuation, score] = await Promise.all([getAmcAnalyticsInputs(a.id), getAmcValuationSeries(a.slug), getAmcAnalyticsScore(a.id)]);
        return { slug: a.slug, inputs, valuation, score };
      })
    ),
  ]);

  const perAmc: RawReportInputs["perAmc"] = {};
  for (const { slug, inputs, valuation, score } of perAmcRows) {
    if (inputs && valuation && score) perAmc[slug] = asJson({ inputs, valuation, score });
  }

  return asJson<RawReportInputs>({
    listed,
    correlations: { ...correlations, computedAt: new Date().toISOString() },
    industryRange: range,
    targetFy,
    flows,
    sipQuarterly: sip,
    perAmc,
  });
}
