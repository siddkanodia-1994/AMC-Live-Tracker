import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import { amcListedStock, amcs, amcValuationDaily, amcValuationRevision, isinDailyPrice } from "../db/schema";
import { computeProvisionalFill, type PriceClose, type ProvisionalFill } from "./provisional";
import { diffValuationRows, summarizeValuationDiff, type ValuationDiff, type ValuationDiffSummaryRow, type ValuationRevision } from "./diff-valuation";
import { ACCORD_CODES, VALUATION_FIELDS, type ValuationRow } from "./parse-valuation-workbook";

const KNOWN_SLUGS = new Set(Object.values(ACCORD_CODES).map((v) => v.slug));
const COMPANY_BY_SLUG = new Map(Object.values(ACCORD_CODES).map((v) => [v.slug, v.company]));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 50_000;
// Rows per write statement -- 8 params a row keeps each one well inside the
// Neon HTTP driver's comfortable size (see isin-price-store.ts's batching).
const WRITE_BATCH = 300;

/**
 * Re-validates rows posted by the browser -- the upload is open to any
 * visitor, so the server never trusts the client's own parse.
 */
export function validateValuationRows(input: unknown): { rows: ValuationRow[]; error: string | null } {
  if (!Array.isArray(input) || input.length === 0) return { rows: [], error: "No rows to upload." };
  if (input.length > MAX_ROWS) return { rows: [], error: `Too many rows (${input.length}); the limit is ${MAX_ROWS}.` };
  const rows: ValuationRow[] = [];
  const seen = new Set<string>();
  for (const r of input) {
    const o = r as Record<string, unknown>;
    if (typeof o?.slug !== "string" || !KNOWN_SLUGS.has(o.slug)) return { rows: [], error: `Unknown AMC: ${String(o?.slug)}` };
    if (typeof o.date !== "string" || !DATE_RE.test(o.date)) return { rows: [], error: `Bad date: ${String(o.date)}` };
    const key = `${o.slug}|${o.date}`;
    if (seen.has(key)) return { rows: [], error: `Duplicate date ${o.date} for ${o.slug}` };
    seen.add(key);
    const row = { slug: o.slug, date: o.date } as ValuationRow;
    for (const f of VALUATION_FIELDS) {
      const v = o[f];
      if (v === null || v === undefined) row[f] = null;
      else if (typeof v === "number" && Number.isFinite(v) && v > -100_000 && v < 100_000) row[f] = v;
      else return { rows: [], error: `Bad ${f} on ${o.date} for ${o.slug}` };
    }
    rows.push(row);
  }
  return { rows, error: null };
}

async function getAmcIdsBySlug(): Promise<Map<string, number>> {
  const rows = await db.select({ id: amcs.id, slug: amcs.slug }).from(amcs).where(inArray(amcs.slug, [...KNOWN_SLUGS]));
  return new Map(rows.map((r) => [r.slug, r.id]));
}

const num = (v: string | null) => (v === null ? null : Number(v));

async function getStoredRows(amcIds: Map<string, number>, slugs: string[]): Promise<ValuationRow[]> {
  const ids = slugs.map((s) => amcIds.get(s)).filter((id): id is number => id !== undefined);
  if (ids.length === 0) return [];
  const slugById = new Map([...amcIds].map(([slug, id]) => [id, slug]));
  const rows = await db
    .select({
      amcId: amcValuationDaily.amcId,
      date: amcValuationDaily.date,
      peCons: amcValuationDaily.peCons,
      peSa: amcValuationDaily.peSa,
      mcapNsCons: amcValuationDaily.mcapNsCons,
      mcapNsSa: amcValuationDaily.mcapNsSa,
    })
    .from(amcValuationDaily)
    .where(inArray(amcValuationDaily.amcId, ids));
  return rows.map((r) => ({
    slug: slugById.get(r.amcId)!,
    date: r.date,
    peCons: num(r.peCons),
    peSa: num(r.peSa),
    mcapNsCons: num(r.mcapNsCons),
    mcapNsSa: num(r.mcapNsSa),
  }));
}

export interface ValuationUploadPreview {
  summary: ValuationDiffSummaryRow[];
  totals: { inserts: number; revisedDates: number; unchanged: number };
  // Capped sample for the preview table -- the full list is in the log after Apply.
  revisions: ValuationRevision[];
  revisionCount: number;
}

async function computeDiff(rows: ValuationRow[]): Promise<{ diff: ValuationDiff; amcIds: Map<string, number> }> {
  const amcIds = await getAmcIdsBySlug();
  const stored = await getStoredRows(amcIds, [...new Set(rows.map((r) => r.slug))]);
  return { diff: diffValuationRows(rows, stored), amcIds };
}

export async function previewValuationUpload(rows: ValuationRow[]): Promise<ValuationUploadPreview> {
  const { diff } = await computeDiff(rows);
  return {
    summary: summarizeValuationDiff(rows, diff),
    totals: { inserts: diff.inserts.length, revisedDates: diff.updates.length, unchanged: diff.unchanged },
    revisions: diff.revisions.slice(0, 50),
    revisionCount: diff.revisions.length,
  };
}

const toNumeric = (v: number | null) => (v === null ? null : String(v));

/**
 * Re-diffs on the server, then upserts new + changed dates and logs every
 * changed field (old -> new). Each chunk's log rows and upserts go in one
 * db.batch, so a chunk is applied all-or-nothing; a failed upload can simply
 * be re-run -- already-applied chunks diff as unchanged. Never deletes.
 */
export async function applyValuationUpload(rows: ValuationRow[], sourceFile: string): Promise<ValuationUploadPreview> {
  const { diff, amcIds } = await computeDiff(rows);
  const writes = [...diff.inserts, ...diff.updates];
  const revisionsByKey = new Map<string, ValuationRevision[]>();
  for (const rev of diff.revisions) {
    const key = `${rev.slug}|${rev.date}`;
    revisionsByKey.set(key, [...(revisionsByKey.get(key) ?? []), rev]);
  }

  for (let i = 0; i < writes.length; i += WRITE_BATCH) {
    const chunk = writes.slice(i, i + WRITE_BATCH);
    const upsert = db
      .insert(amcValuationDaily)
      .values(
        chunk.map((r) => ({
          amcId: amcIds.get(r.slug)!,
          date: r.date,
          peCons: toNumeric(r.peCons),
          peSa: toNumeric(r.peSa),
          mcapNsCons: toNumeric(r.mcapNsCons),
          mcapNsSa: toNumeric(r.mcapNsSa),
          sourceFile,
        }))
      )
      .onConflictDoUpdate({
        target: [amcValuationDaily.amcId, amcValuationDaily.date],
        set: {
          peCons: sql`excluded.pe_cons`,
          peSa: sql`excluded.pe_sa`,
          mcapNsCons: sql`excluded.mcap_ns_cons`,
          mcapNsSa: sql`excluded.mcap_ns_sa`,
          sourceFile: sql`excluded.source_file`,
          updatedAt: sql`now()`,
        },
      });
    const chunkRevisions = chunk.flatMap((r) => revisionsByKey.get(`${r.slug}|${r.date}`) ?? []);
    if (chunkRevisions.length === 0) {
      await upsert;
      continue;
    }
    const log = db.insert(amcValuationRevision).values(
      chunkRevisions.map((rev) => ({
        amcId: amcIds.get(rev.slug)!,
        date: rev.date,
        field: rev.field,
        oldValue: toNumeric(rev.oldValue),
        newValue: toNumeric(rev.newValue),
        sourceFile,
      }))
    );
    await db.batch([log, upsert]);
  }

  return {
    summary: summarizeValuationDiff(rows, diff),
    totals: { inserts: diff.inserts.length, revisedDates: diff.updates.length, unchanged: diff.unchanged },
    revisions: diff.revisions.slice(0, 50),
    revisionCount: diff.revisions.length,
  };
}

export interface ValuationPoint {
  date: string;
  pe: number | null;
  mcapToSales: number | null;
  // Days after the last Ace upload, price-scaled from DHAN closes (see
  // provisional.ts). Never stored -- the next upload replaces them.
  provisional?: boolean;
}

export interface AmcValuationSeries {
  slug: string;
  companyName: string;
  points: ValuationPoint[];
  lastUpload: { sourceFile: string; updatedAt: string } | null;
  // The last real Ace date the provisional days are scaled from, the first
  // provisional date, and the first quarter-end since the anchor (after which
  // Ace will have rolled in new earnings). All null when there is no fill.
  provisionalAnchorDate: string | null;
  provisionalFrom: string | null;
  staleSince: string | null;
}

// How far before the anchor to look for its close (covers holidays/gaps).
const ANCHOR_PRICE_LOOKBACK_DAYS = 10;

async function getClosesFrom(amcId: number, fromDate: string): Promise<PriceClose[]> {
  const [listed] = await db.select({ isin: amcListedStock.isin }).from(amcListedStock).where(eq(amcListedStock.amcId, amcId));
  if (!listed) return [];
  const rows = await db
    .select({ date: isinDailyPrice.snapshotDate, priceInr: isinDailyPrice.priceInr })
    .from(isinDailyPrice)
    .where(and(eq(isinDailyPrice.isin, listed.isin), gte(isinDailyPrice.snapshotDate, fromDate)))
    .orderBy(asc(isinDailyPrice.snapshotDate));
  return rows.map((r) => ({ date: r.date, priceInr: Number(r.priceInr) }));
}

/**
 * One AMC's daily series for the band charts: consolidated where present,
 * else standalone, per date (the user's chosen rule, unmarked on the chart).
 */
export async function getAmcValuationSeries(slug: string): Promise<AmcValuationSeries | null> {
  const [amc] = await db.select({ id: amcs.id, name: amcs.overviewName }).from(amcs).where(eq(amcs.slug, slug));
  if (!amc) return null;
  const [rows, [last]] = await Promise.all([
    db
      .select({
        date: amcValuationDaily.date,
        peCons: amcValuationDaily.peCons,
        peSa: amcValuationDaily.peSa,
        mcapNsCons: amcValuationDaily.mcapNsCons,
        mcapNsSa: amcValuationDaily.mcapNsSa,
      })
      .from(amcValuationDaily)
      .where(eq(amcValuationDaily.amcId, amc.id))
      .orderBy(asc(amcValuationDaily.date)),
    db
      .select({ sourceFile: amcValuationDaily.sourceFile, updatedAt: amcValuationDaily.updatedAt })
      .from(amcValuationDaily)
      .where(eq(amcValuationDaily.amcId, amc.id))
      .orderBy(desc(amcValuationDaily.updatedAt))
      .limit(1),
  ]);
  const points: ValuationPoint[] = rows.map((r) => ({
    date: r.date,
    pe: num(r.peCons) ?? num(r.peSa),
    mcapToSales: num(r.mcapNsCons) ?? num(r.mcapNsSa),
  }));

  // Extend past the last Ace row with price-scaled days (one small query:
  // this AMC's closes from just before that row onward).
  const anchorRows = points.slice(-10);
  const anchor = anchorRows.at(-1);
  let fill: ProvisionalFill = { points: [], staleSince: null };
  if (anchor) {
    const from = new Date(Date.parse(`${anchorRows[0].date}T00:00:00Z`) - ANCHOR_PRICE_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
    fill = computeProvisionalFill(anchorRows, await getClosesFrom(amc.id, from));
  }

  return {
    slug,
    companyName: COMPANY_BY_SLUG.get(slug) ?? amc.name,
    points: [...points, ...fill.points],
    lastUpload: last ? { sourceFile: last.sourceFile, updatedAt: last.updatedAt.toISOString() } : null,
    provisionalAnchorDate: fill.points.length > 0 ? anchor!.date : null,
    provisionalFrom: fill.points[0]?.date ?? null,
    staleSince: fill.staleSince,
  };
}
