// Client for api.tigzig.com/mf/v1 -- a free, public, no-auth API that
// reformats AMFI's own published mutual fund records (NAV history + latest
// quarterly AAUM per scheme). Deliberately independent of DHAN: this
// feature's daily price and periodic AUM baseline both come from here, not
// from instrumentMap/DHAN's LTP feed, so it carries none of DHAN's daily
// token-refresh operational burden. See CC0 licence at
// https://api.tigzig.com/mf/v1/terms.
const BASE_URL = "https://api.tigzig.com/mf/v1";
const NAV_BATCH_SIZE = 50; // TigZig's own documented max schemes per /nav call

export interface EtfNavRow {
  schemeCode: number;
  nav: number;
  date: string;
}

export interface EtfAaumSnapshotRow {
  schemeCode: number;
  aaumCr: number;
  aaumQuarter: string;
  aaumQuarterEnd: string | null; // e.g. "2026-06-30" -- the date to fetch the baseline NAV as of
}

interface TigzigNavApiRow {
  scheme_code: number;
  data: { date: string; nav: number }[];
}

interface TigzigNavApiResponse {
  count: number;
  schemes: TigzigNavApiRow[];
  not_found: (string | number)[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Today's (or the most recent available) NAV for a batch of schemes.
 * Never throws -- a scheme missing from the response (network error,
 * scheme code TigZig doesn't recognize) is simply absent from the
 * returned map, same "degrade, don't abort" convention as fetchLtps.
 */
export async function fetchLatestNav(schemeCodes: number[]): Promise<Map<number, EtfNavRow>> {
  const result = new Map<number, EtfNavRow>();
  if (schemeCodes.length === 0) return result;

  for (const batch of chunk(schemeCodes, NAV_BATCH_SIZE)) {
    try {
      const url = `${BASE_URL}/nav?schemes=${batch.join(",")}&latest=true`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`[tigzig] nav batch failed with status ${res.status}`);
        continue;
      }
      const json = (await res.json()) as TigzigNavApiResponse;
      for (const row of json.schemes ?? []) {
        const latest = row.data?.[0];
        if (latest) result.set(row.scheme_code, { schemeCode: row.scheme_code, nav: latest.nav, date: latest.date });
      }
    } catch (err) {
      console.error("[tigzig] network error fetching nav batch:", err);
    }
  }

  return result;
}

/**
 * NAV as of a specific date for a batch of schemes -- the closest available
 * trading day on or before `date`, via a bounded lookback window (quarter-end
 * dates are almost always trading days themselves, but this tolerates a
 * weekend/holiday quarter-end without special-casing it). Used to anchor a
 * newly-captured quarter's baseline to the NAV that was actually current
 * then, not today's -- the "latest snapshot" file's own `nav` column is
 * always today's NAV regardless of which quarter's AAUM the row carries.
 */
export async function fetchNavAsOf(schemeCodes: number[], date: string): Promise<Map<number, EtfNavRow>> {
  const result = new Map<number, EtfNavRow>();
  if (schemeCodes.length === 0) return result;

  const since = new Date(`${date}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 7);
  const sinceStr = since.toISOString().slice(0, 10);

  for (const batch of chunk(schemeCodes, NAV_BATCH_SIZE)) {
    try {
      const url = `${BASE_URL}/nav?schemes=${batch.join(",")}&since=${sinceStr}&to=${date}&latest=true`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`[tigzig] nav-as-of batch failed with status ${res.status}`);
        continue;
      }
      const json = (await res.json()) as TigzigNavApiResponse;
      for (const row of json.schemes ?? []) {
        const latest = row.data?.[0];
        if (latest) result.set(row.scheme_code, { schemeCode: row.scheme_code, nav: latest.nav, date: latest.date });
      }
    } catch (err) {
      console.error("[tigzig] network error fetching nav-as-of batch:", err);
    }
  }

  return result;
}

/**
 * A single CSV line, RFC4180-ish (handles double-quoted fields with
 * embedded commas/quotes) -- TigZig's bulk file is almost entirely
 * unquoted, but a handful of scheme names do need it.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * The latest quarterly AAUM for a batch of schemes -- downloads TigZig's
 * full ~38K-scheme "latest snapshot" file (a few MB, once) and filters down
 * to just the requested scheme codes. There is no lighter per-scheme
 * endpoint for this field (confirmed against TigZig's own schema docs: it
 * only exists on this bulk file, never on /search or /nav). AAUM is
 * inherently quarterly, so calling this once a day is far more often than
 * the underlying data ever changes -- cheap, simple, and always correct.
 */
export async function fetchLatestAaumSnapshot(schemeCodes: number[]): Promise<Map<number, EtfAaumSnapshotRow>> {
  const result = new Map<number, EtfAaumSnapshotRow>();
  if (schemeCodes.length === 0) return result;
  const wanted = new Set(schemeCodes);

  const res = await fetch(`${BASE_URL}/download?format=latest`);
  if (!res.ok) {
    console.error(`[tigzig] latest-snapshot download failed with status ${res.status}`);
    return result;
  }
  const text = await res.text();
  const lines = text.split("\n");
  const header = parseCsvLine(lines[0]);
  const col = (name: string) => header.indexOf(name);
  const aaumCol = col("aaum_cr_quarterly_avg");
  const quarterCol = col("aaum_quarter");
  const quarterEndCol = col("aaum_quarter_end");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    // scheme_code is always the first, unquoted, comma-free column -- cheap
    // pre-filter before the full parse, since only ~40 of ~38,000 rows matter.
    const commaIdx = line.indexOf(",");
    const rawCode = commaIdx === -1 ? line : line.slice(0, commaIdx);
    const schemeCode = Number(rawCode);
    if (!wanted.has(schemeCode)) continue;

    const fields = parseCsvLine(line);
    const aaumRaw = fields[aaumCol];
    const quarter = fields[quarterCol];
    if (!aaumRaw || !quarter) continue; // no disclosed quarter yet (e.g. a brand-new scheme)
    result.set(schemeCode, {
      schemeCode,
      aaumCr: Number(aaumRaw),
      aaumQuarter: quarter,
      aaumQuarterEnd: fields[quarterEndCol] || null,
    });
  }

  return result;
}
