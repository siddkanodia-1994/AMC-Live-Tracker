// The cross-AMC quarterly SIP table (AMC Analytics › SIP & Score): pure
// pieces shared by the server (mirroring card saves, building the payload)
// and the table. Quarters are Indian fiscal ones (Q1 = Apr–Jun, FY27 ends
// Mar 2027), keyed "2027-2" for Q2FY27.

import { quarterLabel, shiftQuarter, type FiscalQuarter } from "./industry-sip";

/** The Fortnightly AMC SIP card's 5 slots, as quarters back from its anchor. */
export const SIP_SLOT_OFFSETS = [0, -1, -2, -4, -5] as const;

/** Card field → its slot and which store column it fills. */
export const SIP_SLOT_FIELDS = {
  sipAmcQtdValCr: { slot: 0, column: "sipCr" },
  sipAmcPrevQValCr: { slot: 1, column: "sipCr" },
  sipAmcPrevQ2ValCr: { slot: 2, column: "sipCr" },
  sipAmcYoyQValCr: { slot: 3, column: "sipCr" },
  sipAmcYoyQ2ValCr: { slot: 4, column: "sipCr" },
  sipAmcQtdPct: { slot: 0, column: "sipEqAumPct" },
  sipAmcPrevQPct: { slot: 1, column: "sipEqAumPct" },
  sipAmcPrevQ2Pct: { slot: 2, column: "sipEqAumPct" },
  sipAmcYoyQPct: { slot: 3, column: "sipEqAumPct" },
  sipAmcYoyQ2Pct: { slot: 4, column: "sipEqAumPct" },
} as const;

export type SipSlotField = keyof typeof SIP_SLOT_FIELDS;
export type SipColumn = "sipCr" | "sipEqAumPct";

export function isSipSlotField(field: string): field is SipSlotField {
  return field in SIP_SLOT_FIELDS;
}

/** The quarter a card slot stands for, given the card's anchor. */
export function slotQuarter(anchor: FiscalQuarter, slot: number): FiscalQuarter {
  return shiftQuarter(anchor, SIP_SLOT_OFFSETS[slot]);
}

export const quarterKey = ({ fy, q }: FiscalQuarter) => `${fy}-${q}`;

export interface SipQuarterValue {
  sipCr: number | null;
  sipEqAumPct: number | null;
}

/** One AMC's row: stored quarters, with the card's own 5 slots laid over them. */
export function overlayCardSlots(
  stored: Record<string, SipQuarterValue>,
  anchor: FiscalQuarter,
  slots: { sipCr: (number | null)[]; sipEqAumPct: (number | null)[] }
): Record<string, SipQuarterValue> {
  const out: Record<string, SipQuarterValue> = { ...stored };
  SIP_SLOT_OFFSETS.forEach((_, slot) => {
    const key = quarterKey(slotQuarter(anchor, slot));
    const base = out[key] ?? { sipCr: null, sipEqAumPct: null };
    out[key] = {
      sipCr: slots.sipCr[slot] ?? base.sipCr,
      sipEqAumPct: slots.sipEqAumPct[slot] ?? base.sipEqAumPct,
    };
  });
  return out;
}

/** The table's first column: Q1FY25. */
export const MATRIX_FIRST_QUARTER: FiscalQuarter = { fy: 2025, q: 1 };

/** Q1FY25 → `last`, oldest first (at least the first quarter). */
export function matrixQuarters(last: FiscalQuarter): { key: string; label: string; quarter: FiscalQuarter }[] {
  const index = ({ fy, q }: FiscalQuarter) => fy * 4 + q;
  const count = Math.max(1, index(last) - index(MATRIX_FIRST_QUARTER) + 1);
  return Array.from({ length: count }, (_, i) => {
    const quarter = shiftQuarter(MATRIX_FIRST_QUARTER, i);
    return { key: quarterKey(quarter), label: quarterLabel(quarter), quarter };
  });
}

/** Latest quarter vs the same quarter a year earlier (relative change). */
export function yoyOfLatest(values: (number | null)[]): number | null {
  const a = values.at(-1) ?? null;
  const b = values.length >= 5 ? values[values.length - 5] : null;
  return a !== null && b !== null && b !== 0 ? a / b - 1 : null;
}
