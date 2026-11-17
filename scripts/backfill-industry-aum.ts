// Industry-wide daily equity AUM before the live series (May 2022 → Dec 2025),
// modelled with the 8 AMCs' method (src/lib/aum/industry-backfill.ts) from
// the user's "AUM Breakup" workbook: its "AUM data" sheet's Equity column,
// Apr 2022 (the seed) through Dec 2025. Each month's figure is placed on
// that month's last NIFTY_500 trading day -- the workbook dates Mar 2025 on
// a holiday (31 Mar) and Oct/Dec 2025 on the 30th although the 31st traded.
// Rows from 2026 on are ignored: the live series covers them.
//
// Dry run by default: prints the months, the run's range and the seam with
// the live series, and writes nothing. Pass --write to upsert the anchors
// and daily estimates (safe to re-run; unique on month / date).
//   npx tsx scripts/backfill-industry-aum.ts "<path to AUM Breakup.xlsx>"
//   npx tsx scripts/backfill-industry-aum.ts "<path>" --write
import * as XLSX from "xlsx";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { indexDailyLevel, industryHistoricalAumAnchor, industryHistoricalAumEstimate, liveAumDailySnapshot } from "../src/lib/db/schema";
import { anchorMonths, computeAnchoredDailyAum, type MonthExitAum } from "../src/lib/aum/industry-backfill";

const SHEET = "AUM data";
const FIRST_MONTH = "2022-04";
const LAST_MONTH = "2025-12";
const BATCH = 500;

function readEquityMonths(path: string): MonthExitAum[] {
  const wb = XLSX.readFile(path, { cellDates: true });
  const sheet = wb.Sheets[SHEET];
  if (!sheet) throw new Error(`Sheet "${SHEET}" not found in ${path}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true }) as unknown[][];
  const head = rows[0] as (string | null)[];
  const iDate = head.indexOf("Date");
  const iEquity = head.indexOf("Equity");
  if (iDate < 0 || iEquity < 0) throw new Error(`Expected "Date" and "Equity" columns, found: ${head.join(", ")}`);
  const months = new Map<string, number>();
  for (const r of rows.slice(1)) {
    if (!(r[iDate] instanceof Date) || typeof r[iEquity] !== "number") continue;
    // Cells hold IST midnight, which reads as 18:30 UTC the day before.
    const month = new Date((r[iDate] as Date).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 7);
    if (month < FIRST_MONTH || month > LAST_MONTH) continue;
    if (months.has(month)) throw new Error(`Two rows for ${month}`);
    months.set(month, r[iEquity] as number);
  }
  return [...months].map(([reportMonth, exitAumCr]) => ({ reportMonth, exitAumCr }));
}

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  for (;;) {
    const s = `${y}-${String(m).padStart(2, "0")}`;
    out.push(s);
    if (s === last) return out;
    if (m === 12) {
      y += 1;
      m = 1;
    } else {
      m += 1;
    }
  }
}

async function main() {
  const path = process.argv[2];
  const write = process.argv.includes("--write");
  if (!path) throw new Error("Pass the workbook path as the first argument");

  const months = readEquityMonths(path);
  const missing = monthsBetween(FIRST_MONTH, LAST_MONTH).filter((m) => !months.some((x) => x.reportMonth === m));
  if (missing.length) throw new Error(`Workbook is missing ${missing.join(", ")}`);

  const levels = (
    await db
      .select({ date: indexDailyLevel.snapshotDate, level: sql<number>`${indexDailyLevel.levelValue}::float` })
      .from(indexDailyLevel)
      .where(and(eq(indexDailyLevel.indexKey, "NIFTY_500"), gte(indexDailyLevel.snapshotDate, `${FIRST_MONTH}-01`), lte(indexDailyLevel.snapshotDate, "2025-12-31")))
      .orderBy(asc(indexDailyLevel.snapshotDate))
  ).map((l) => ({ date: l.date, level: Number(l.level) }));

  const anchors = anchorMonths(months, levels);
  const { rows, segments } = computeAnchoredDailyAum(anchors, levels);

  for (const s of segments) {
    console.log(
      `${s.reportMonth}  ${s.monthEndDate}  ${anchors.find((a) => a.reportMonth === s.reportMonth)!.exitAumCr.toLocaleString("en-IN").padStart(10)}  ` +
        `${String(s.tradingDays).padStart(2)}d  index ${(s.indexReturn * 100).toFixed(1).padStart(5)}%  aum ${(s.aumReturn * 100).toFixed(1).padStart(5)}%  gap ${(s.gapPct * 100).toFixed(2).padStart(5)}%`
    );
  }
  const [firstLive] = await db
    .select({ date: liveAumDailySnapshot.snapshotDate, aum: sql<number>`sum(${liveAumDailySnapshot.liveAumCr})::float` })
    .from(liveAumDailySnapshot)
    .where(eq(liveAumDailySnapshot.isCanonical, true))
    .groupBy(liveAumDailySnapshot.snapshotDate)
    .orderBy(asc(liveAumDailySnapshot.snapshotDate))
    .limit(1);
  const last = rows[rows.length - 1];
  if (firstLive && last.date >= firstLive.date) throw new Error(`Estimates reach ${last.date}, on or after live data's first day ${firstLive.date}`);
  console.log(`\n${anchors.length} anchors, ${segments.length} months, ${rows.length} days: ${rows[0].date} → ${last.date}`);
  if (firstLive) {
    console.log(`Seam: ${last.date} ₹${Math.round(last.estimatedAumCr).toLocaleString("en-IN")} Cr → live ${firstLive.date} ₹${Math.round(Number(firstLive.aum)).toLocaleString("en-IN")} Cr (${((Number(firstLive.aum) / last.estimatedAumCr - 1) * 100).toFixed(2)}%)`);
  }

  if (!write) {
    console.log("\nDry run: nothing written. Pass --write to upsert.");
    return;
  }

  for (const a of anchors) {
    await db
      .insert(industryHistoricalAumAnchor)
      .values({ reportMonth: a.reportMonth, monthEndDate: a.monthEndDate, exitAumCr: String(a.exitAumCr) })
      .onConflictDoUpdate({
        target: industryHistoricalAumAnchor.reportMonth,
        set: { monthEndDate: sql`excluded.month_end_date`, exitAumCr: sql`excluded.exit_aum_cr` },
      });
  }
  for (let i = 0; i < rows.length; i += BATCH) {
    await db
      .insert(industryHistoricalAumEstimate)
      .values(
        rows.slice(i, i + BATCH).map((r) => ({
          snapshotDate: r.date,
          estimatedAumCr: String(r.estimatedAumCr),
          rawCompoundedAumCr: String(r.rawCompoundedAumCr),
          anchorMonthEndDate: r.anchorMonthEndDate,
        }))
      )
      .onConflictDoUpdate({
        target: industryHistoricalAumEstimate.snapshotDate,
        set: {
          estimatedAumCr: sql`excluded.estimated_aum_cr`,
          rawCompoundedAumCr: sql`excluded.raw_compounded_aum_cr`,
          anchorMonthEndDate: sql`excluded.anchor_month_end_date`,
          computedAt: sql`now()`,
        },
      });
  }
  console.log(`\nWrote ${anchors.length} anchors and ${rows.length} daily rows.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
