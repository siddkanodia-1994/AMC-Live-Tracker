function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Scans the first `searchWithinRows` rows of a sheet (already extracted as an
 * array of row-arrays via `sheet_to_json(ws, { header: 1 })`) for a row whose
 * cells contain every one of `expectedTokens`. Used as a fallback verifier for
 * the fixed-row assumptions in parse-overview/parse-amc-sheet — if a future
 * workbook export shifts rows, this throws a descriptive error instead of
 * silently misreading columns.
 *
 * Returns the 0-based row index.
 */
export function locateHeaderRow(
  rows: unknown[][],
  expectedTokens: string[],
  searchWithinRows: number,
  context: string
): number {
  const normalizedTokens = expectedTokens.map(normalize);
  const limit = Math.min(searchWithinRows, rows.length);

  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    const normalizedCells = row.map(normalize);
    const hasAllTokens = normalizedTokens.every((token) =>
      normalizedCells.some((cell) => cell === token)
    );
    if (hasAllTokens) return i;
  }

  throw new Error(
    `[${context}] Could not locate a header row containing all of ${JSON.stringify(
      expectedTokens
    )} within the first ${searchWithinRows} rows. The workbook layout may have changed.`
  );
}

/**
 * Asserts the header row is at the expected 0-based index, verified via
 * locateHeaderRow. Throws if the fixed assumption doesn't hold.
 */
export function assertHeaderRowAt(
  rows: unknown[][],
  expectedTokens: string[],
  expectedIndex: number,
  searchWithinRows: number,
  context: string
): void {
  const found = locateHeaderRow(rows, expectedTokens, searchWithinRows, context);
  if (found !== expectedIndex) {
    throw new Error(
      `[${context}] Expected header row at index ${expectedIndex} (row ${
        expectedIndex + 1
      }) but found it at index ${found} (row ${found + 1}). The workbook layout has shifted — update the parser's row assumptions.`
    );
  }
}
