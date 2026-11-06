import { VALUATION_FIELDS, type ValuationField, type ValuationRow } from "./parse-valuation-workbook";

// Splits an uploaded file's rows against what's already stored: dates never
// seen before are inserts, dates whose value changed in any field are
// revisions (one entry per changed field, so the change log can record old
// -> new), everything else is skipped. Stored dates absent from the file
// are left alone -- an upload never deletes history.

export interface ValuationRevision {
  slug: string;
  date: string;
  field: ValuationField;
  oldValue: number | null;
  newValue: number | null;
}

export interface ValuationDiff {
  inserts: ValuationRow[];
  updates: ValuationRow[];
  revisions: ValuationRevision[];
  unchanged: number;
}

// Stored values are numeric(12, 4); compare at that precision so a value
// that merely round-tripped through Postgres never reads as "changed".
const round4 = (v: number | null) => (v === null ? null : Math.round(v * 10_000) / 10_000);

export function diffValuationRows(incoming: ValuationRow[], stored: ValuationRow[]): ValuationDiff {
  const storedByKey = new Map(stored.map((r) => [`${r.slug}|${r.date}`, r]));
  const diff: ValuationDiff = { inserts: [], updates: [], revisions: [], unchanged: 0 };
  for (const row of incoming) {
    const prev = storedByKey.get(`${row.slug}|${row.date}`);
    if (!prev) {
      diff.inserts.push(row);
      continue;
    }
    const changed = VALUATION_FIELDS.filter((f) => round4(prev[f]) !== round4(row[f]));
    if (changed.length === 0) {
      diff.unchanged++;
      continue;
    }
    diff.updates.push(row);
    for (const field of changed) {
      diff.revisions.push({ slug: row.slug, date: row.date, field, oldValue: prev[field], newValue: row[field] });
    }
  }
  return diff;
}

export interface ValuationDiffSummaryRow {
  slug: string;
  inserts: number;
  revisedDates: number;
  unchanged: number;
  firstNewDate: string | null;
  lastNewDate: string | null;
}

/** Per-AMC counts for the upload preview table. */
export function summarizeValuationDiff(incoming: ValuationRow[], diff: ValuationDiff): ValuationDiffSummaryRow[] {
  const bySlug = new Map<string, ValuationDiffSummaryRow>();
  const get = (slug: string) => {
    let s = bySlug.get(slug);
    if (!s) {
      s = { slug, inserts: 0, revisedDates: 0, unchanged: 0, firstNewDate: null, lastNewDate: null };
      bySlug.set(slug, s);
    }
    return s;
  };
  for (const r of incoming) get(r.slug);
  for (const r of diff.inserts) {
    const s = get(r.slug);
    s.inserts++;
    if (!s.firstNewDate || r.date < s.firstNewDate) s.firstNewDate = r.date;
    if (!s.lastNewDate || r.date > s.lastNewDate) s.lastNewDate = r.date;
  }
  for (const r of diff.updates) get(r.slug).revisedDates++;
  const touched = new Map<string, number>();
  for (const r of [...diff.inserts, ...diff.updates]) touched.set(r.slug, (touched.get(r.slug) ?? 0) + 1);
  for (const s of bySlug.values()) {
    s.unchanged = incoming.filter((r) => r.slug === s.slug).length - (touched.get(s.slug) ?? 0);
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}
