import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { importWorkbook } from "../src/lib/excel/import-workbook";
import { runPostImportReclaim } from "../src/lib/aum/reclaim-forward-gap";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: tsx scripts/import-excel.ts <path-to-xlsx>");
    process.exit(1);
  }

  const buffer = readFileSync(filePath);
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
