// Mechanical number check for the weekly report's commentary: each bullet
// cites figures.json paths (refs), and every number in its text must be one
// of those figures as displayed (rounded to the decimals shown, in %, bps,
// x, SD, ₹ lakh Cr or ₹ '000 Cr). Small counts ("7 of 8") and calendar
// labels (dates, quarters, years) are listed but not matched. Claims and
// wording are left to the checker agent; this only proves the numbers.

import type { CommentaryBullet, WeeklyCommentary, WeeklyReportData } from "./types";

// Month names only ("Mar", "March"), not words that start like one ("Market").
const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\b";
// Optional sign and ₹, the number, then an optional unit.
const NUMBER_RE = new RegExp(String.raw`([+\-−]?)(₹\s?)?(\d[\d,]*(?:\.\d+)?)(\s?(?:%|bps|x\b|SD\b|lakh Cr|'000 Cr))?`, "g");

export type TokenKind = "matched" | "unmatched" | "count" | "label";

export interface VerifiedToken {
  text: string;
  kind: TokenKind;
  /** The ref that matched, for "matched". */
  ref?: string;
}

export interface VerifiedBullet {
  where: string;
  lead: string;
  refs: { path: string; value: unknown; ok: boolean }[];
  tokens: VerifiedToken[];
}

export interface VerifyResult {
  bullets: VerifiedBullet[];
  summary: { bullets: number; numbers: number; matched: number; unmatched: number; badRefs: number };
}

/**
 * "amcs.HDFC.aum.qoq", "amcs.Canara Robeco.targets.average.base",
 * "industry.quarters.-1.value", "amcs.SBI.ratio.levels.sd:-1.price".
 * An array segment is an index (negative from the end), "key:value", or a
 * name matched against each element's short / slug / label.
 */
export function resolvePath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      if (/^-?\d+$/.test(seg)) {
        const i = Number(seg);
        cur = cur[i < 0 ? cur.length + i : i];
      } else if (seg.includes(":")) {
        const [k, v] = seg.split(":");
        cur = cur.find((e) => e != null && String((e as Record<string, unknown>)[k]) === v);
      } else {
        cur = cur.find((e) => {
          const o = e as Record<string, unknown>;
          return o?.short === seg || o?.slug === seg || o?.label === seg;
        });
      }
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

function decimalsOf(s: string): number {
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

function candidates(v: number, unit: string): number[] {
  switch (unit) {
    case "%":
      return [v * 100, v];
    case "bps":
      return [v, v * 10000];
    case "lakh Cr":
      return [v / 100000];
    case "'000 Cr":
      return [v / 1000];
    default:
      return [v];
  }
}

function matches(display: number, dp: number, sign: string, v: number, unit: string): boolean {
  const tol = 0.5 * 10 ** -dp + 1e-9;
  return candidates(v, unit).some((c) => {
    if (sign === "+" && c < 0) return false;
    if ((sign === "-" || sign === "−") && c > 0) return false;
    return Math.abs(Math.abs(c) - display) <= tol;
  });
}

function isLabel(text: string, start: number, end: number, raw: string, hasComma: boolean): boolean {
  const before = text.slice(Math.max(0, start - 3), start);
  const after = text.slice(end, end + 12);
  if (/(?:Q|FY|H)$/.test(before)) return true; // Q3, FY27
  if (new RegExp(`^\\s?${MONTH}`).test(after)) return true; // 30 Sep
  if (new RegExp(`\\b${MONTH}\\s$`).test(text.slice(Math.max(0, start - 10), start))) return true; // Sep 30
  if (!hasComma && /^(19|20)\d{2}$/.test(raw)) return true; // 2026, but not 2,045
  if (/^\s?(?:D|-day|day|days|sessions?)\b/.test(after) && Number(raw) <= 250) return true; // 45D, 5 sessions (window names)
  return false;
}

function checkBullet(data: WeeklyReportData, b: CommentaryBullet, where: string): VerifiedBullet {
  const refs = (b.refs ?? []).map((path) => {
    const value = resolvePath(data, path);
    return { path, value, ok: typeof value === "number" && Number.isFinite(value) };
  });
  const text = `${b.lead} ${b.text}`;
  const tokens: VerifiedToken[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const [whole, sign, rupee, rawNum, unitRaw] = m;
    const start = m.index ?? 0;
    const raw = rawNum.replace(/,/g, "");
    const unit = (unitRaw ?? "").trim();
    // A hyphen between two words/numbers is a range or compound, not a minus.
    const realSign = sign === "-" && /[\w)]$/.test(text.slice(0, start)) ? "" : sign;
    const display = Number(raw);
    if (!unit && !rupee && isLabel(text, start + sign.length, start + whole.length, raw, rawNum.includes(","))) {
      tokens.push({ text: whole.trim(), kind: "label" });
      continue;
    }
    if (!unit && !rupee && Number.isInteger(display) && display <= 12 && !rawNum.includes(".")) {
      tokens.push({ text: whole.trim(), kind: "count" });
      continue;
    }
    const hit = refs.find((r) => r.ok && matches(display, decimalsOf(raw), realSign, r.value as number, unit));
    tokens.push(hit ? { text: whole.trim(), kind: "matched", ref: hit.path } : { text: whole.trim(), kind: "unmatched" });
  }
  return { where, lead: b.lead, refs, tokens };
}

export function verifyCommentary(data: WeeklyReportData, commentary: WeeklyCommentary): VerifyResult {
  const bullets: VerifiedBullet[] = [];
  commentary.takeaways.forEach((b, i) => bullets.push(checkBullet(data, b, `takeaways.${i}`)));
  for (const [key, list] of Object.entries(commentary.sections)) list?.forEach((b, i) => bullets.push(checkBullet(data, b, `sections.${key}.${i}`)));
  commentary.nextWeek?.forEach((b, i) => bullets.push(checkBullet(data, b, `nextWeek.${i}`)));
  const all = bullets.flatMap((b) => b.tokens);
  return {
    bullets,
    summary: {
      bullets: bullets.length,
      numbers: all.filter((t) => t.kind === "matched" || t.kind === "unmatched").length,
      matched: all.filter((t) => t.kind === "matched").length,
      unmatched: all.filter((t) => t.kind === "unmatched").length,
      badRefs: bullets.flatMap((b) => b.refs).filter((r) => !r.ok).length,
    },
  };
}
