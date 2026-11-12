// One-off backfill for amc_sip_quarterly (AMC Analytics › SIP & Score's
// cross-AMC table), approved 2026-11-12:
//   - SIP / Eq AUM % for Q1FY25–Q2FY27, keyed in from the user's own sheet
//     (screenshot); IPRU's three #DIV/0! quarters stay empty.
//   - Each AMC's latest Fortnightly SIP card: its 5 quarters' SIP ₹ Cr (and
//     %, where the sheet has none for that quarter).
//   - HDFC's 5 card % slots corrected to the sheet (the user confirmed the
//     sheet is right; the stored ones were a quarter behind).
// Dry run by default: prints every row and change. Pass --write to apply.
// Safe to re-run (upserts by AMC + quarter, and by snapshot field).
//
//   npx tsx scripts/backfill-sip-quarterly.ts            # dry run
//   npx tsx scripts/backfill-sip-quarterly.ts --write    # apply
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { amcFortnightlyUpdate, amcs, amcSipQuarterly } from "../src/lib/db/schema";
import { saveFortnightlyField, type FortnightlyFieldName } from "../src/lib/aum/fortnightly-update";
import { upsertSipQuarter } from "../src/lib/aum/sip-quarterly";
import { quarterLabel, shiftQuarter, type FiscalQuarter } from "../src/lib/aum/industry-sip";
import { quarterKey, slotQuarter } from "../src/lib/aum/sip-quarterly-matrix";
import { getFiscalYearAndQuarter } from "../src/lib/aum/report-period";

const WRITE = process.argv.includes("--write");
const FIRST: FiscalQuarter = { fy: 2025, q: 1 };
const QUARTERS = Array.from({ length: 10 }, (_, i) => shiftQuarter(FIRST, i)); // Q1FY25 … Q2FY27

// The user's sheet, SIP / Eq AUM % (null = blank / #DIV/0!).
const SHEET: Record<string, (number | null)[]> = {
  "hdfc-mutual-fund": [8.9, 8.9, 9.0, 8.9, 9.0, 9.5, 9.4, 9.7, 9.4, 8.9],
  "nippon-india-mutual-fund": [12.5, 12.9, 14.4, 14.8, 13.6, 13.7, 13.3, 13.2, 12.5, 11.8],
  "aditya-birla-sun-life-mutual-fund": [8.1, 8.1, 7.7, 8.3, 7.6, 6.9, 6.5, 7.3, 6.6, 6.3],
  "canara-robeco-mutual-fund": [10.6, 9.2, 9.2, 9.8, 8.8, 8.5, 8.2, 8.2, 7.7, 7.0],
  "icici-prudential-mutual-fund": [null, null, null, 9.5, 9.7, 10.2, 9.9, 9.9, 9.3, 8.5],
  "motilal-oswal-mutual-fund": [8.8, 10.6, 13.4, 14.0, 13.4, 13.7, 13.3, 12.7, 11.2, 10.3],
};
const HDFC = "hdfc-mutual-fund";

const toNum = (v: string | null) => (v === null ? null : Number(v));
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const PCT_FIELDS = ["sipAmcQtdPct", "sipAmcPrevQPct", "sipAmcPrevQ2Pct", "sipAmcYoyQPct", "sipAmcYoyQ2Pct"] as const;
const VAL_FIELDS = ["sipAmcQtdValCr", "sipAmcPrevQValCr", "sipAmcPrevQ2ValCr", "sipAmcYoyQValCr", "sipAmcYoyQ2ValCr"] as const;

async function main() {
  const slugs = [...new Set([...Object.keys(SHEET), "sbi-mutual-fund", "uti-mutual-fund"])];
  const amcRows = await db.select({ id: amcs.id, slug: amcs.slug }).from(amcs).where(inArray(amcs.slug, slugs));
  const idBySlug = new Map(amcRows.map((a) => [a.slug, a.id]));
  const existing = await db.select().from(amcSipQuarterly);
  const existingKey = new Set(existing.map((r) => `${r.amcId}:${r.fiscalYear}-${r.quarter}`));

  let rows = 0;
  let cardChanges = 0;
  for (const slug of slugs) {
    const amcId = idBySlug.get(slug);
    if (!amcId) throw new Error(`AMC not found: ${slug}`);
    const [card] = await db
      .select()
      .from(amcFortnightlyUpdate)
      .where(eq(amcFortnightlyUpdate.amcId, amcId))
      .orderBy(desc(amcFortnightlyUpdate.asOfDate))
      .limit(1);
    const d = card ? getFiscalYearAndQuarter(card.asOfDate) : null;
    const anchor: FiscalQuarter | null = card ? { fy: toNum(card.sipAmcLatestFy) ?? d!.fy, q: toNum(card.sipAmcLatestQuarter) ?? d!.q } : null;

    // What goes in per quarter.
    const plan = new Map<string, { quarter: FiscalQuarter; sipCr: number | null; sipEqAumPct: number | null }>();
    QUARTERS.forEach((q, i) => {
      const v = SHEET[slug]?.[i] ?? null;
      plan.set(quarterKey(q), { quarter: q, sipCr: null, sipEqAumPct: v === null ? null : Math.round(v * 10) / 1000 });
    });
    if (card && anchor) {
      VAL_FIELDS.forEach((f, slot) => {
        const q = slotQuarter(anchor, slot);
        const k = quarterKey(q);
        const entry = plan.get(k) ?? { quarter: q, sipCr: null, sipEqAumPct: null };
        entry.sipCr = toNum(card[f]);
        if (entry.sipEqAumPct === null) entry.sipEqAumPct = toNum(card[PCT_FIELDS[slot]]);
        plan.set(k, entry);
      });
    }

    console.log(`\n${slug} (id ${amcId})${anchor ? ` · card anchor ${quarterLabel(anchor)}, snapshot ${card!.asOfDate}` : " · no card"}`);
    for (const p of [...plan.values()].sort((a, b) => a.quarter.fy * 4 + a.quarter.q - (b.quarter.fy * 4 + b.quarter.q))) {
      if (p.sipCr === null && p.sipEqAumPct === null) continue;
      const exists = existingKey.has(`${amcId}:${p.quarter.fy}-${p.quarter.q}`);
      console.log(`  ${quarterLabel(p.quarter).padEnd(7)} SIP ₹ Cr ${p.sipCr === null ? "—" : p.sipCr.toLocaleString("en-IN")}`.padEnd(32) + `  SIP / Eq AUM ${pct(p.sipEqAumPct)}${exists ? "  (overwrites a stored row)" : ""}`);
      rows++;
      if (WRITE) {
        if (p.sipCr !== null) await upsertSipQuarter(amcId, p.quarter, "sipCr", p.sipCr);
        if (p.sipEqAumPct !== null) await upsertSipQuarter(amcId, p.quarter, "sipEqAumPct", p.sipEqAumPct);
      }
    }

    // HDFC: the card's own % slots move to the sheet's figures.
    if (slug === HDFC && card && anchor) {
      for (const [slot, field] of PCT_FIELDS.entries()) {
        const q = slotQuarter(anchor, slot);
        const sheetV = SHEET[HDFC][QUARTERS.findIndex((x) => quarterKey(x) === quarterKey(q))];
        if (sheetV == null) continue;
        const next = Math.round(sheetV * 10) / 1000;
        const now = toNum(card[field]);
        if (now !== null && Math.abs(now - next) < 1e-9) continue;
        console.log(`  card ${field} (${quarterLabel(q)}): ${pct(now)} → ${pct(next)}`);
        cardChanges++;
        if (WRITE) await saveFortnightlyField(amcId, card.asOfDate, field as FortnightlyFieldName, next);
      }
    }
  }
  console.log(`\n${WRITE ? "Wrote" : "Dry run:"} ${rows} quarter rows, ${cardChanges} HDFC card changes.${WRITE ? "" : " Nothing written; pass --write to apply."}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
