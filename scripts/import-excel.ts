import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { dryRunWorkbook, type DryRunIsin, type DryRunReport } from "../src/lib/excel/dry-run-workbook";

const LIST_LIMIT = 50;

function cr(n: number | null): string {
  return n == null ? "-" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signedCr(n: number): string {
  // Round first so float noise on an exact match prints "+0.00", not "-0.00".
  const rounded = Math.round(n * 100) / 100 || 0;
  return `${rounded >= 0 ? "+" : ""}${cr(rounded)}`;
}

function pct(n: number, base: number): string {
  if (base === 0) return "n/a";
  const p = ((n - base) / base) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(2)}%`;
}

function printIsins(title: string, isins: DryRunIsin[]) {
  console.log(`\n${title}: ${isins.length}`);
  for (const i of isins.slice(0, LIST_LIMIT)) {
    console.log(`  ${i.isin}  ${i.companyName}  [${i.amcs.join(", ")}]`);
  }
  if (isins.length > LIST_LIMIT) console.log(`  ... and ${isins.length - LIST_LIMIT} more`);
}

function printDryRun(fileName: string, r: DryRunReport) {
  console.log(`DRY RUN -- nothing was written. File: ${fileName}`);

  const gaps = r.mapGaps;
  console.log(`\nOverview names missing from data/amc-name-map.json: ${gaps ? gaps.missingFromMap.length : "unknown"}`);
  for (const name of gaps?.missingFromMap ?? []) console.log(`  - ${name}`);
  if (gaps && gaps.missingSheets.length > 0) {
    console.log(`Mapped sheets missing from the workbook: ${gaps.missingSheets.length}`);
    for (const s of gaps.missingSheets) console.log(`  - ${s}`);
  }

  if (r.blockingError) {
    console.log(`\nBLOCKING: the real import would fail on this file:\n  ${r.blockingError}`);
    return;
  }

  console.log(`\nReport period (file): ${r.reportPeriod}`);
  console.log(`Live period (DB):     ${r.livePeriod ?? "(none)"}${r.wouldAdvanceLivePeriod ? "  -> would ADVANCE to the file's period" : ""}`);
  const kind =
    r.comparisonKind === "same-period"
      ? "same period, already imported -- a real import would OVERWRITE it"
      : r.comparisonKind === "prior-period"
        ? "latest older period -- a real import would ADD a new period"
        : "no earlier period in the DB";
  console.log(`Compared against:     ${r.comparisonPeriod ?? "(nothing)"} (${kind})`);

  console.log(`\nAMC count: file ${r.amcCount.file} vs DB ${r.amcCount.comparison ?? "-"}`);
  if (r.newAmcSlugs.length > 0) console.log(`  New AMCs (would be created in amcs): ${r.newAmcSlugs.join(", ")}`);

  const t = r.totalAum;
  console.log(`\nTotal reported AUM (cr): ${cr(t.fileCr)}`);
  if (r.comparisonKind === "same-period" && t.comparisonDbCr != null) {
    console.log(`  vs DB ${r.comparisonPeriod}:  ${cr(t.comparisonDbCr)}  (diff ${signedCr(t.fileCr - t.comparisonDbCr)})`);
  }
  if (t.priorDbCr != null) {
    console.log(`  Change vs DB ${r.priorPeriod}: ${signedCr(t.fileCr - t.priorDbCr)} (${pct(t.fileCr, t.priorDbCr)})`);
    console.log(
      `  File's own prev-month column: ${cr(t.filePrevMonthCr)} vs DB ${r.priorPeriod} ${cr(t.priorDbCr)} (diff ${signedCr(t.filePrevMonthCr - t.priorDbCr)})`
    );
  }

  const fileHoldings = r.perAmc.reduce((n, a) => n + (a.fileHoldings ?? 0), 0);
  const dbHoldings = r.perAmc.reduce((n, a) => n + (a.dbHoldings ?? 0), 0);
  console.log(`\nHoldings: file ${fileHoldings} vs DB ${r.comparisonPeriod ? dbHoldings : "-"}`);
  const differing = r.perAmc.filter(
    (a) =>
      a.fileHoldings !== a.dbHoldings ||
      a.fileAumCr == null ||
      a.dbAumCr == null ||
      Math.abs(a.fileAumCr - a.dbAumCr) >= 0.005
  );
  console.log(`Per-AMC: ${r.perAmc.length - differing.length} match exactly, ${differing.length} differ`);
  if (differing.length > 0) {
    console.log(`  ${"AMC".padEnd(40)} ${"AUM file".padStart(14)} ${"AUM DB".padStart(14)} ${"holdings file/DB".padStart(18)}`);
    for (const a of differing) {
      console.log(
        `  ${a.overviewName.slice(0, 40).padEnd(40)} ${cr(a.fileAumCr).padStart(14)} ${cr(a.dbAumCr).padStart(14)} ${`${a.fileHoldings ?? "-"} / ${a.dbHoldings ?? "-"}`.padStart(18)}`
      );
    }
  }

  console.log(`\nDistinct ISINs in file: ${r.isins.fileDistinct} (${r.isins.filePriceableDistinct} priceable)`);
  if (r.comparisonPeriod) printIsins(`ISINs not held by any AMC in DB ${r.comparisonPeriod}`, r.isins.newVsComparison);
  printIsins("Priceable ISINs missing from instrument_map", r.isins.unmappedPriceable);

  console.log(`\nCash Holdings (official CCE%) rows: ${r.cce.rows}`);
  if (r.cce.unmatchedSheetNames.length > 0) {
    console.log(`  Unmatched sheet names (would be skipped): ${r.cce.unmatchedSheetNames.join(", ")}`);
  }

  console.log(`\nParse warnings (${r.warnings.length}):`);
  for (const w of r.warnings) console.log(`  - ${w}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filePath = args.find((a) => !a.startsWith("--"));
  if (!filePath) {
    console.error("Usage: tsx scripts/import-excel.ts [--dry-run] <path-to-xlsx>");
    process.exit(1);
  }

  const buffer = readFileSync(filePath);

  if (dryRun) {
    const report = await dryRunWorkbook(buffer);
    printDryRun(basename(filePath), report);
    if (report.blockingError) process.exit(1);
    return;
  }

  // Loaded only for a real import, so a dry run never even loads the
  // transactional client.
  const { importWorkbook } = await import("../src/lib/excel/import-workbook");
  const { runPostImportReclaim } = await import("../src/lib/aum/reclaim-forward-gap");

  const result = await importWorkbook(buffer, basename(filePath));

  console.log(`Report period: ${result.reportPeriod}`);
  console.log(`AMCs imported: ${result.amcsImported}`);
  console.log(`Holdings imported: ${result.holdingsImported}`);
  console.log(`Official CCE% rows imported: ${result.cceRowsImported}`);
  if (result.warnings.length > 0) {
    console.log(`\nWarnings (${result.warnings.length}):`);
    for (const w of result.warnings) console.log(`  - ${w}`);
  }

  // Same follow-up the Admin upload route triggers automatically -- run it
  // here too so a direct script import never reintroduces the "forgot to
  // sync instruments / reclaim the forward gap" gap this was built to close.
  if (result.advancedToNewPeriod) {
    console.log(`\nNew report period detected -- running instrument sync + forward-gap reclaim for ${result.reportPeriod}...`);
    const outcome = await runPostImportReclaim(result.importLogId);
    if (outcome.status === "success") {
      console.log("Auto-reclaim succeeded:", JSON.stringify(outcome.result, null, 2));
    } else {
      console.error("Auto-reclaim FAILED:", outcome.error);
      console.error("The import itself succeeded -- retry via the Admin page's 'Recalculate live AUM through today' button.");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
