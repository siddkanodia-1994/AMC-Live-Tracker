import { read } from "xlsx";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { amcPeriods, amcs, appSettings, holdings, instrumentMap } from "../db/schema";
import { findMapCoverageGaps, type MapCoverageGaps } from "./amc-name-map";
import { parseOverviewSheet } from "./parse-overview";
import { parseWorkbook, type ParsedWorkbook } from "./parse-workbook";

// Zero-write validation of a tracker file against what's already in the DB,
// for reviewing a new month's file before the real import. Every query here
// is a SELECT through the neon-http client -- this module must never import
// lib/db/transactional-client (directly or via import-workbook.ts).

const CURRENT_REPORT_PERIOD_KEY = "current_report_period";

// Same batch size isin-price-store.ts uses -- the HTTP driver times out on
// inArray() lists in the thousands.
const ISIN_BATCH_SIZE = 500;

export interface DryRunAmcRow {
  overviewName: string;
  slug: string;
  fileAumCr: number | null;
  dbAumCr: number | null;
  fileHoldings: number | null;
  dbHoldings: number | null;
}

export interface DryRunIsin {
  isin: string;
  companyName: string;
  amcs: string[];
}

export interface DryRunReport {
  // Set when parseWorkbook() throws -- the real import would fail the same way.
  blockingError: string | null;
  mapGaps: MapCoverageGaps | null;
  reportPeriod: string | null;
  livePeriod: string | null;
  wouldAdvanceLivePeriod: boolean;
  // The period the file is diffed against: the same period when it's already
  // imported (a re-import would overwrite it), else the latest older period.
  comparisonPeriod: string | null;
  comparisonKind: "same-period" | "prior-period" | "none";
  // Latest period strictly older than the file's, for the AUM change.
  priorPeriod: string | null;
  amcCount: { file: number; comparison: number | null };
  // Slugs with no row in the amcs table -- the import would create them.
  newAmcSlugs: string[];
  totalAum: {
    fileCr: number;
    // Sum of the file's own previous-month column -- should tie to priorDbCr.
    filePrevMonthCr: number;
    comparisonDbCr: number | null;
    priorDbCr: number | null;
  };
  perAmc: DryRunAmcRow[];
  isins: {
    fileDistinct: number;
    filePriceableDistinct: number;
    // ISINs held in the file but by no AMC in the comparison period.
    newVsComparison: DryRunIsin[];
    // Priceable ISINs with no instrument_map row (no live price until synced).
    unmappedPriceable: DryRunIsin[];
  };
  cce: { rows: number; unmatchedSheetNames: string[] };
  warnings: string[];
}

function emptyReport(): DryRunReport {
  return {
    blockingError: null,
    mapGaps: null,
    reportPeriod: null,
    livePeriod: null,
    wouldAdvanceLivePeriod: false,
    comparisonPeriod: null,
    comparisonKind: "none",
    priorPeriod: null,
    amcCount: { file: 0, comparison: null },
    newAmcSlugs: [],
    totalAum: { fileCr: 0, filePrevMonthCr: 0, comparisonDbCr: null, priorDbCr: null },
    perAmc: [],
    isins: { fileDistinct: 0, filePriceableDistinct: 0, newVsComparison: [], unmappedPriceable: [] },
    cce: { rows: 0, unmatchedSheetNames: [] },
    warnings: [],
  };
}

async function selectIsinsIn(isins: string[], query: (batch: string[]) => Promise<{ isin: string | null }[]>) {
  const found = new Set<string>();
  for (let i = 0; i < isins.length; i += ISIN_BATCH_SIZE) {
    for (const row of await query(isins.slice(i, i + ISIN_BATCH_SIZE))) {
      if (row.isin) found.add(row.isin);
    }
  }
  return found;
}

async function loadPeriodAum(period: string) {
  const rows = await db
    .select({ slug: amcs.slug, reportedAumCr: amcPeriods.reportedAumCr })
    .from(amcPeriods)
    .innerJoin(amcs, eq(amcPeriods.amcId, amcs.id))
    .where(eq(amcPeriods.reportPeriod, period));
  return new Map(rows.map((r) => [r.slug, Number(r.reportedAumCr)]));
}

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export async function dryRunWorkbook(fileBuffer: Buffer): Promise<DryRunReport> {
  const report = emptyReport();

  let parsed: ParsedWorkbook;
  try {
    parsed = parseWorkbook(fileBuffer);
  } catch (err) {
    report.blockingError = err instanceof Error ? err.message : String(err);
    // Re-derive the map gaps on their own so every unmapped name is listed,
    // not just the thrown message (the Overview itself may be what failed).
    try {
      const wb = read(fileBuffer, { type: "buffer", cellDates: false });
      report.mapGaps = findMapCoverageGaps(wb, parseOverviewSheet(wb));
    } catch {
      // Overview unparseable -- blockingError already says why.
    }
    return report;
  }

  const { reportPeriod } = parsed;
  report.reportPeriod = reportPeriod;
  report.mapGaps = { missingFromMap: [], missingSheets: [] }; // parseWorkbook already asserted this
  report.warnings = parsed.warnings;
  report.amcCount.file = parsed.amcs.length;
  report.totalAum.fileCr = sum(parsed.amcs.map((a) => a.overviewRow.reportedAumCr));
  report.totalAum.filePrevMonthCr = sum(parsed.amcs.map((a) => a.overviewRow.prevReportedAumCr));

  const [live] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, CURRENT_REPORT_PERIOD_KEY));
  report.livePeriod = live?.value ?? null;
  report.wouldAdvanceLivePeriod = !live || reportPeriod > live.value;

  // amc_periods is ~one row per AMC per month, so one aggregate pass is cheap.
  const [periodInfo] = await db
    .select({
      samePeriodRows: sql<number>`count(*) filter (where ${amcPeriods.reportPeriod} = ${reportPeriod})`.mapWith(Number),
      priorPeriod: sql<string | null>`max(${amcPeriods.reportPeriod}) filter (where ${amcPeriods.reportPeriod} < ${reportPeriod})`,
    })
    .from(amcPeriods);
  report.priorPeriod = periodInfo.priorPeriod;
  if (periodInfo.samePeriodRows > 0) {
    report.comparisonPeriod = reportPeriod;
    report.comparisonKind = "same-period";
  } else if (periodInfo.priorPeriod) {
    report.comparisonPeriod = periodInfo.priorPeriod;
    report.comparisonKind = "prior-period";
  }

  const allAmcs = await db.select({ slug: amcs.slug, sheetName: amcs.sheetName }).from(amcs);
  const knownSlugs = new Set(allAmcs.map((a) => a.slug));
  report.newAmcSlugs = parsed.amcs.map((a) => a.entry.slug).filter((s) => !knownSlugs.has(s));

  // Same matching rule importWorkbook() applies to the Cash Holdings sheet.
  const knownSheetNames = new Set(allAmcs.map((a) => a.sheetName.trim().toLowerCase()));
  for (const a of parsed.amcs) knownSheetNames.add(a.entry.sheetName.trim().toLowerCase());
  report.cce.rows = parsed.cashHoldings.rows.length;
  report.cce.unmatchedSheetNames = [
    ...new Set(
      parsed.cashHoldings.rows
        .filter((r) => !knownSheetNames.has(r.sheetName.trim().toLowerCase()))
        .map((r) => r.sheetName)
    ),
  ];

  const comparisonAum = report.comparisonPeriod ? await loadPeriodAum(report.comparisonPeriod) : null;
  const priorAum =
    report.priorPeriod == null
      ? null
      : report.priorPeriod === report.comparisonPeriod
        ? comparisonAum
        : await loadPeriodAum(report.priorPeriod);
  report.amcCount.comparison = comparisonAum?.size ?? null;
  report.totalAum.comparisonDbCr = comparisonAum ? sum(comparisonAum.values()) : null;
  report.totalAum.priorDbCr = priorAum ? sum(priorAum.values()) : null;

  const comparisonHoldings = new Map<string, number>();
  if (report.comparisonPeriod) {
    const rows = await db
      .select({ slug: amcs.slug, n: count() })
      .from(holdings)
      .innerJoin(amcs, eq(holdings.amcId, amcs.id))
      .where(eq(holdings.reportPeriod, report.comparisonPeriod))
      .groupBy(amcs.slug);
    for (const r of rows) comparisonHoldings.set(r.slug, r.n);
  }

  const fileSlugs = new Set<string>();
  for (const a of parsed.amcs) {
    fileSlugs.add(a.entry.slug);
    report.perAmc.push({
      overviewName: a.entry.overviewName,
      slug: a.entry.slug,
      fileAumCr: a.overviewRow.reportedAumCr,
      dbAumCr: comparisonAum?.get(a.entry.slug) ?? null,
      fileHoldings: a.sheet.holdings.length,
      dbHoldings: comparisonAum ? comparisonHoldings.get(a.entry.slug) ?? 0 : null,
    });
  }
  // AMCs in the comparison period that this file doesn't have at all.
  for (const [slug, dbAumCr] of comparisonAum ?? []) {
    if (fileSlugs.has(slug)) continue;
    report.perAmc.push({
      overviewName: slug,
      slug,
      fileAumCr: null,
      dbAumCr,
      fileHoldings: null,
      dbHoldings: comparisonHoldings.get(slug) ?? 0,
    });
  }

  const fileIsins = new Map<string, DryRunIsin & { isPriceable: boolean }>();
  for (const a of parsed.amcs) {
    for (const h of a.sheet.holdings) {
      if (!h.isin) continue;
      const existing = fileIsins.get(h.isin);
      if (existing) {
        existing.amcs.push(a.entry.overviewName);
        existing.isPriceable ||= h.isPriceable;
      } else {
        fileIsins.set(h.isin, { isin: h.isin, companyName: h.companyName, amcs: [a.entry.overviewName], isPriceable: h.isPriceable });
      }
    }
  }
  const allIsins = [...fileIsins.keys()].sort();
  const priceableIsins = allIsins.filter((i) => fileIsins.get(i)!.isPriceable);
  report.isins.fileDistinct = allIsins.length;
  report.isins.filePriceableDistinct = priceableIsins.length;

  const toEntry = (isin: string): DryRunIsin => {
    const { companyName, amcs: heldBy } = fileIsins.get(isin)!;
    return { isin, companyName, amcs: heldBy };
  };

  const mapped = await selectIsinsIn(priceableIsins, (batch) =>
    db.select({ isin: instrumentMap.isin }).from(instrumentMap).where(inArray(instrumentMap.isin, batch))
  );
  report.isins.unmappedPriceable = priceableIsins.filter((i) => !mapped.has(i)).map(toEntry);

  if (report.comparisonPeriod) {
    const comparisonPeriod = report.comparisonPeriod;
    const held = await selectIsinsIn(allIsins, (batch) =>
      db
        .selectDistinct({ isin: holdings.isin })
        .from(holdings)
        .where(and(eq(holdings.reportPeriod, comparisonPeriod), inArray(holdings.isin, batch)))
    );
    report.isins.newVsComparison = allIsins.filter((i) => !held.has(i)).map(toEntry);
  }

  return report;
}
