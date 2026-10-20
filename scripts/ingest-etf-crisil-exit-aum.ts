// Ingests real month-end (and, from May-2026 onward, fortnightly) Exit AUM
// for every Gold/Silver ETF scheme from the user's own CRISIL "Index Funds"
// archive (3 Year AMFI Data/), into etf_exit_aum_anchor. Re-runnable: pass a
// specific folder to ingest just one month/fortnight (the normal monthly
// cadence going forward) instead of re-scanning everything.
//
// Usage:
//   npm run ingest-etf-exit-aum                 -- scans every folder
//   npm run ingest-etf-exit-aum -- "<folder>"    -- scans just that one
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { read, utils } from "xlsx";
import { sql } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { etfSchemes, etfExitAumAnchor } from "../src/lib/db/schema";
import { classifyCrisilName } from "../src/lib/etf/crisil-name-map";

const ROOT = "3 Year AMFI Data";

function excelSerialToIso(serial: number): string {
  // Excel's epoch is 1899-12-30 (accounting for the classic 1900 leap-year bug).
  const utcDays = Math.floor(serial - 25569);
  const ms = utcDays * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

const MONTH_ABBR: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

// The NAV Date column is usually a raw Excel serial number, but 3 of the 59
// real files (Jan/Mar/Apr-2026) store it as a "DD-Mon-YYYY" string instead
// (confirmed by direct inspection -- inconsistent across files, not a
// time-based cutover) -- this handles both without assuming either.
function parseNavDateCell(cell: unknown): string | null {
  if (typeof cell === "number") return excelSerialToIso(cell);
  if (typeof cell === "string") {
    const m = cell.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (m) {
      const month = MONTH_ABBR[m[2].toLowerCase()];
      if (month) return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
    }
  }
  return null;
}

interface ParsedFileRow {
  crisilName: string;
  aumCr: number;
}

interface ParsedFile {
  anchorDate: string;
  rows: ParsedFileRow[];
}

function findIndexFundsFile(folderPath: string): string {
  const files = readdirSync(folderPath).filter((f) => /index.*fund/i.test(f) && !f.startsWith("~$") && f.endsWith(".xlsx"));
  if (files.length === 0) throw new Error(`${folderPath}: no "Index Funds" file found`);
  if (files.length > 1) throw new Error(`${folderPath}: multiple candidate "Index Funds" files: ${files.join(", ")}`);
  return join(folderPath, files[0]);
}

function parseIndexFundsFile(filePath: string): ParsedFile {
  const buf = readFileSync(filePath);
  const wb = read(buf, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });

  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if ((rows[i] as unknown[])[0] === "Scheme Name") {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) throw new Error(`${filePath}: no header row ("Scheme Name") found`);

  const header = rows[headerIdx] as string[];
  const aumCol = header.findIndex((h) => /daily aum/i.test(String(h ?? "")));
  if (aumCol === -1) throw new Error(`${filePath}: no "Daily AUM" column found in header`);
  const navDateCol = header.findIndex((h) => /nav date/i.test(String(h ?? "")));
  if (navDateCol === -1) throw new Error(`${filePath}: no "NAV Date" column found in header`);

  const parsedRows: ParsedFileRow[] = [];
  let anchorDate: string | null = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] as unknown[];
    const name = String(row[0] ?? "").trim();
    if (!name || !/gold|silver/i.test(name)) continue;

    const d = parseNavDateCell(row[navDateCol]);
    if (d !== null) {
      if (anchorDate === null) anchorDate = d;
      else if (anchorDate !== d) {
        throw new Error(`${filePath}: inconsistent NAV Date within file (saw both ${anchorDate} and ${d}) -- expected one date per file`);
      }
    }

    const rawAum = row[aumCol];
    if (rawAum == null || rawAum === "") continue; // scheme exists in the file but has no AUM figure this period -- skip, not an error
    const aumCr = typeof rawAum === "number" ? rawAum : parseFloat(String(rawAum));
    if (!Number.isFinite(aumCr)) continue;

    parsedRows.push({ crisilName: name, aumCr });
  }

  if (anchorDate === null) throw new Error(`${filePath}: no Gold/Silver row had a parseable NAV Date`);
  return { anchorDate, rows: parsedRows };
}

async function main() {
  const folderArg = process.argv[2];
  const folderNames = folderArg
    ? [folderArg]
    : readdirSync(ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== "__pycache__")
        .map((d) => d.name)
        .sort();

  const schemeRows = await db.select({ id: etfSchemes.id, slug: etfSchemes.slug }).from(etfSchemes);
  const schemeIdBySlug = new Map(schemeRows.map((s) => [s.slug, s.id]));

  const unknownNames = new Map<string, Set<string>>(); // name -> folders it was seen in
  const anchorsToWrite: (typeof etfExitAumAnchor.$inferInsert)[] = [];
  let filesProcessed = 0;

  for (const folderName of folderNames) {
    const folderPath = join(ROOT, folderName);
    const filePath = findIndexFundsFile(folderPath);
    const parsed = parseIndexFundsFile(filePath);

    for (const row of parsed.rows) {
      const classification = classifyCrisilName(row.crisilName);
      if (classification.type === "excluded") continue;
      if (classification.type === "unknown") {
        if (!unknownNames.has(row.crisilName)) unknownNames.set(row.crisilName, new Set());
        unknownNames.get(row.crisilName)!.add(folderName);
        continue;
      }
      const schemeId = schemeIdBySlug.get(classification.schemeSlug);
      if (!schemeId) {
        throw new Error(`[ingest-etf-crisil-exit-aum] Mapped slug "${classification.schemeSlug}" (from "${row.crisilName}") has no matching etfSchemes row -- check the slug or add the scheme.`);
      }
      anchorsToWrite.push({
        schemeId,
        anchorDate: parsed.anchorDate,
        exitAumCr: String(row.aumCr),
        sourceFile: filePath,
      });
    }
    filesProcessed++;
  }

  if (unknownNames.size > 0) {
    const details = [...unknownNames.entries()].map(([name, folders]) => `"${name}" (seen in ${folders.size} folder(s), e.g. ${[...folders][0]})`).join("\n  ");
    throw new Error(
      `[ingest-etf-crisil-exit-aum] ${unknownNames.size} unmapped Gold/Silver name(s) found -- update data/etf-crisil-name-map.json (either map to a schemeSlug, or add to excludedNames if it's a known non-ETF product):\n  ${details}`
    );
  }

  console.log(`Parsed ${filesProcessed} file(s), ${anchorsToWrite.length} Gold/Silver anchor rows to upsert.`);

  const BATCH_SIZE = 500;
  for (let i = 0; i < anchorsToWrite.length; i += BATCH_SIZE) {
    const batch = anchorsToWrite.slice(i, i + BATCH_SIZE);
    await db
      .insert(etfExitAumAnchor)
      .values(batch)
      .onConflictDoUpdate({
        target: [etfExitAumAnchor.schemeId, etfExitAumAnchor.anchorDate],
        set: { exitAumCr: sql`excluded.exit_aum_cr`, sourceFile: sql`excluded.source_file` },
      });
  }

  console.log(`Done. Upserted ${anchorsToWrite.length} anchor rows across ${filesProcessed} file(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
