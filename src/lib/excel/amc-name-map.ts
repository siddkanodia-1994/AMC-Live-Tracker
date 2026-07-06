import type { WorkBook } from "xlsx";
import amcNameMapJson from "../../../data/amc-name-map.json";
import type { AmcNameMapEntry, OverviewRow } from "./types";

const AMC_NAME_MAP: AmcNameMapEntry[] = amcNameMapJson;

export function getAmcMap(): AmcNameMapEntry[] {
  return AMC_NAME_MAP;
}

export function getMapEntryByOverviewName(overviewName: string): AmcNameMapEntry | undefined {
  return AMC_NAME_MAP.find((e) => e.overviewName === overviewName);
}

/**
 * Hard-fails the import if any Overview row or workbook sheet name can't be
 * mapped, rather than silently dropping an AMC — a silently-missing AMC would
 * understate total industry AUM with no visible signal.
 */
export function assertMapCoversWorkbook(wb: WorkBook, overviewRows: OverviewRow[]): void {
  const missingFromMap: string[] = [];
  const missingSheets: string[] = [];

  for (const row of overviewRows) {
    const entry = getMapEntryByOverviewName(row.overviewName);
    if (!entry) {
      missingFromMap.push(row.overviewName);
      continue;
    }
    if (!wb.SheetNames.includes(entry.sheetName)) {
      missingSheets.push(`${entry.overviewName} -> "${entry.sheetName}"`);
    }
  }

  if (missingFromMap.length > 0 || missingSheets.length > 0) {
    const parts: string[] = [];
    if (missingFromMap.length > 0) {
      parts.push(
        `Overview names with no entry in data/amc-name-map.json: ${missingFromMap.join(", ")}`
      );
    }
    if (missingSheets.length > 0) {
      parts.push(`Mapped sheet names not found in the workbook: ${missingSheets.join(", ")}`);
    }
    throw new Error(
      `[amc-name-map] Mapping does not cover the uploaded workbook. ${parts.join(
        " | "
      )}. Update data/amc-name-map.json to match.`
    );
  }

  // Not an exact-match requirement: a historical workbook (an older month)
  // legitimately has fewer AMCs than the current map, since funds launch and
  // never retroactively un-launch. Every row's name is already confirmed to
  // exist in the map above, so the only way this count could exceed the
  // map's is a duplicate AMC name within the workbook itself -- a genuine
  // data problem worth catching, unlike simply having fewer rows.
  if (overviewRows.length > AMC_NAME_MAP.length) {
    throw new Error(
      `[amc-name-map] Overview has ${overviewRows.length} AMCs, more than the map's ${AMC_NAME_MAP.length} entries — likely a duplicate AMC name in the workbook.`
    );
  }
}
