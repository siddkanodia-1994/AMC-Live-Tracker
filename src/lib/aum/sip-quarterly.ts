// Reads and writes amc_sip_quarterly: each listed AMC's quarterly SIP (₹ Cr)
// and SIP / Eq AUM %, for AMC Analytics' cross-AMC SIP table. See
// sip-quarterly-matrix.ts for the pure pieces.

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { amcFortnightlyUpdate, amcListedStock, amcs, amcSipQuarterly } from "../db/schema";
import { getFiscalYearAndQuarter } from "./report-period";
import { getAmcAbbreviation } from "./amc-names";
import { getIstDateString } from "../utils/date";
import type { FiscalQuarter } from "./industry-sip";
import { isSipSlotField, overlayCardSlots, quarterKey, SIP_SLOT_FIELDS, slotQuarter, type SipColumn, type SipQuarterValue } from "./sip-quarterly-matrix";

const toNum = (v: string | null) => (v === null ? null : Number(v));

/** The card's anchor quarter on one snapshot row (unset → the snapshot date's own quarter). */
function anchorOf(row: { asOfDate: string; sipAmcLatestFy: string | null; sipAmcLatestQuarter: string | null }): FiscalQuarter {
  const d = getFiscalYearAndQuarter(row.asOfDate);
  return { fy: toNum(row.sipAmcLatestFy) ?? d.fy, q: toNum(row.sipAmcLatestQuarter) ?? d.q };
}

/** Write one quarter's value (only the given column; the other is kept). */
export async function upsertSipQuarter(amcId: number, quarter: FiscalQuarter, column: SipColumn, value: number | null): Promise<void> {
  const dbValue = value === null ? null : String(value);
  await db
    .insert(amcSipQuarterly)
    .values({ amcId, fiscalYear: quarter.fy, quarter: quarter.q, [column]: dbValue })
    .onConflictDoUpdate({
      target: [amcSipQuarterly.amcId, amcSipQuarterly.fiscalYear, amcSipQuarterly.quarter],
      set: { [column]: dbValue, updatedAt: new Date() },
    });
}

/**
 * Save one manual cell on a Fortnightly snapshot row, and -- for an AMC SIP
 * card figure -- the same figure into its quarter's history, in one atomic
 * batch: both are written or neither is, so a failure comes back to the
 * caller rather than leaving the two apart. A blank card cell leaves the
 * stored history alone (a cleared slot isn't a revision of that quarter).
 */
export async function saveSnapshotFieldWithHistory(
  amcId: number,
  asOfDate: string,
  field: string,
  value: number | string | null
): Promise<void> {
  const dbValue = value === null ? null : String(value);
  const snapshotWrite = db
    .insert(amcFortnightlyUpdate)
    .values({ amcId, asOfDate, [field]: dbValue })
    .onConflictDoUpdate({
      target: [amcFortnightlyUpdate.amcId, amcFortnightlyUpdate.asOfDate],
      set: { [field]: dbValue, updatedAt: new Date() },
    });
  if (!isSipSlotField(field) || typeof value !== "number") {
    await snapshotWrite;
    return;
  }
  const [row] = await db
    .select({
      asOfDate: amcFortnightlyUpdate.asOfDate,
      sipAmcLatestFy: amcFortnightlyUpdate.sipAmcLatestFy,
      sipAmcLatestQuarter: amcFortnightlyUpdate.sipAmcLatestQuarter,
    })
    .from(amcFortnightlyUpdate)
    .where(and(eq(amcFortnightlyUpdate.amcId, amcId), eq(amcFortnightlyUpdate.asOfDate, asOfDate)));
  const anchor = anchorOf(row ?? { asOfDate, sipAmcLatestFy: null, sipAmcLatestQuarter: null });
  const { slot, column } = SIP_SLOT_FIELDS[field];
  const quarter = slotQuarter(anchor, slot);
  const historyWrite = db
    .insert(amcSipQuarterly)
    .values({ amcId, fiscalYear: quarter.fy, quarter: quarter.q, [column]: dbValue })
    .onConflictDoUpdate({
      target: [amcSipQuarterly.amcId, amcSipQuarterly.fiscalYear, amcSipQuarterly.quarter],
      set: { [column]: dbValue, updatedAt: new Date() },
    });
  await db.batch([snapshotWrite, historyWrite]);
}

export interface SipMatrixAmc {
  amcId: number;
  slug: string;
  name: string;
  /** quarterKey ("2027-2") → values; the latest card's 5 quarters win over stored ones. */
  quarters: Record<string, SipQuarterValue>;
  /** The latest card's anchor quarter. */
  anchor: FiscalQuarter;
}

/** Every listed AMC's quarterly SIP history, with its latest Fortnightly card laid over it. */
export async function getSipQuarterlyMatrix(): Promise<SipMatrixAmc[]> {
  const listed = await db
    .select({ id: amcs.id, slug: amcs.slug })
    .from(amcListedStock)
    .innerJoin(amcs, eq(amcListedStock.amcId, amcs.id));
  const ids = listed.map((a) => a.id);
  if (ids.length === 0) return [];

  const [stored, cards] = await Promise.all([
    db.select().from(amcSipQuarterly).where(inArray(amcSipQuarterly.amcId, ids)),
    // Only each AMC's latest snapshot row, and only the SIP card's columns.
    db
      .selectDistinctOn([amcFortnightlyUpdate.amcId], {
        amcId: amcFortnightlyUpdate.amcId,
        asOfDate: amcFortnightlyUpdate.asOfDate,
        sipAmcLatestFy: amcFortnightlyUpdate.sipAmcLatestFy,
        sipAmcLatestQuarter: amcFortnightlyUpdate.sipAmcLatestQuarter,
        sipAmcQtdValCr: amcFortnightlyUpdate.sipAmcQtdValCr,
        sipAmcPrevQValCr: amcFortnightlyUpdate.sipAmcPrevQValCr,
        sipAmcPrevQ2ValCr: amcFortnightlyUpdate.sipAmcPrevQ2ValCr,
        sipAmcYoyQValCr: amcFortnightlyUpdate.sipAmcYoyQValCr,
        sipAmcYoyQ2ValCr: amcFortnightlyUpdate.sipAmcYoyQ2ValCr,
        sipAmcQtdPct: amcFortnightlyUpdate.sipAmcQtdPct,
        sipAmcPrevQPct: amcFortnightlyUpdate.sipAmcPrevQPct,
        sipAmcPrevQ2Pct: amcFortnightlyUpdate.sipAmcPrevQ2Pct,
        sipAmcYoyQPct: amcFortnightlyUpdate.sipAmcYoyQPct,
        sipAmcYoyQ2Pct: amcFortnightlyUpdate.sipAmcYoyQ2Pct,
      })
      .from(amcFortnightlyUpdate)
      .where(inArray(amcFortnightlyUpdate.amcId, ids))
      .orderBy(amcFortnightlyUpdate.amcId, desc(amcFortnightlyUpdate.asOfDate)),
  ]);

  return listed.map((a) => {
    const own: Record<string, SipQuarterValue> = {};
    for (const r of stored) {
      if (r.amcId !== a.id) continue;
      own[quarterKey({ fy: r.fiscalYear, q: r.quarter })] = { sipCr: toNum(r.sipCr), sipEqAumPct: toNum(r.sipEqAumPct) };
    }
    const card = cards.find((c) => c.amcId === a.id);
    if (!card) return { amcId: a.id, slug: a.slug, name: getAmcAbbreviation(a.id), quarters: own, anchor: getFiscalYearAndQuarter(getIstDateString()) };
    const anchor = anchorOf(card);
    return {
      amcId: a.id,
      slug: a.slug,
      name: getAmcAbbreviation(a.id),
      anchor,
      quarters: overlayCardSlots(own, anchor, {
        sipCr: [card.sipAmcQtdValCr, card.sipAmcPrevQValCr, card.sipAmcPrevQ2ValCr, card.sipAmcYoyQValCr, card.sipAmcYoyQ2ValCr].map(toNum),
        sipEqAumPct: [card.sipAmcQtdPct, card.sipAmcPrevQPct, card.sipAmcPrevQ2Pct, card.sipAmcYoyQPct, card.sipAmcYoyQ2Pct].map(toNum),
      }),
    };
  });
}
