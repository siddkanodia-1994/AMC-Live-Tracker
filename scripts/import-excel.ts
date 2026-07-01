import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { importWorkbook } from "../src/lib/excel/import-workbook";

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
  if (result.warnings.length > 0) {
    console.log(`\nWarnings (${result.warnings.length}):`);
    for (const w of result.warnings) console.log(`  - ${w}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
