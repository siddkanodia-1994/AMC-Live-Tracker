// The weekly report as one static HTML page (inline SVG charts, print CSS,
// no scripts or external assets), laid out like the user's broker weekly.
// Tables and charts come only from the computed figures; the commentary
// (written separately and number-checked) fills the bullet slots.

import type { AmcWeekly, CommentaryBullet, CommentarySection, WeeklyCommentary, WeeklyReportData } from "./types";
import { weeklyReportFileBase } from "./file-name";
import { shortDate } from "./next-week";

const COLOR: Record<string, string> = {
  HDFC: "#1f63d6",
  "ICICI Pru": "#e8642c",
  SBI: "#7b3fd0",
  Nippon: "#d62f3a",
  ABSL: "#c08a00",
  UTI: "#0e8fa6",
  "Canara Robeco": "#1e9e55",
  Motilal: "#d1337f",
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** "Q3 FY 2027" → "Q3 FY27"; "FY 2027 November" → "Nov". */
export const qLabel = (l: string) => l.replace(/FY (\d{2})(\d{2})/, "FY$2");
export const mLabel = (l: string) => l.replace(/^FY \d{4} /, "").slice(0, 3);

export function inr(v: number | null | undefined, dp = 0): string {
  return v == null || !Number.isFinite(v) ? "–" : v.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Signed % with 1 decimal: +7.1%, −2.4%. */
export function pct(v: number | null | undefined, dp = 1): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const r = Number((v * 100).toFixed(dp));
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(dp)}%`;
}

const tone = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "" : v >= 0.0005 ? "pos" : v <= -0.0005 ? "neg" : "");
const cp = (v: number | null | undefined, dp = 1) => `<td class="num ${tone(v)}">${pct(v, dp)}</td>`;
const rs = (v: number | null | undefined, dp = 0) => (v == null || !Number.isFinite(v) ? "–" : `₹${inr(v, dp)}`);
const sharePct = (v: number | null | undefined) => (v == null ? "–" : `${(v * 100).toFixed(2)}%`);
const bps = (v: number | null | undefined) => (v == null ? "–" : `${v >= 0.5 ? "+" : v <= -0.5 ? "−" : ""}${Math.abs(Math.round(v))} bps`);
const sd = (v: number | null | undefined) => (v == null ? "–" : `${v >= 0.05 ? "+" : v <= -0.05 ? "−" : ""}${Math.abs(v).toFixed(1)} SD`);
const amcName = (a: AmcWeekly) => `<span class="amc" style="color:${COLOR[a.short] ?? "#1d3557"}">${escapeHtml(a.short)}</span>`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dd = (date: string) => `${Number(date.slice(8, 10))} ${MON[Number(date.slice(5, 7)) - 1]}`;
const ddy = (date: string) => `${dd(date)} ${date.slice(0, 4)}`;
const monYy = (date: string) => `${MON[Number(date.slice(5, 7)) - 1]} ${date.slice(2, 4)}`;

// ---------- charts ----------
function quarterBars(a: AmcWeekly): string {
  const W = 200,
    H = 118,
    pad = 22,
    base = H - 26;
  const qs = a.aum.quarterly.filter((x) => x.value != null);
  if (!qs.length) return "";
  const vals = qs.map((x) => x.value! / 1000);
  const max = Math.max(...vals) * 1.12;
  const bw = (W - pad) / vals.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" class="mini" role="img" aria-label="${escapeHtml(a.short)} quarterly average AUM">`;
  for (const t of [0, 0.5, 1]) {
    const y = base - (base - 8) * t;
    s += `<line x1="${pad}" x2="${W}" y1="${y}" y2="${y}" class="grid"/><text x="${pad - 3}" y="${y + 3}" class="ax" text-anchor="end">${Math.round(max * t)}</text>`;
  }
  vals.forEach((v, i) => {
    const h = ((base - 8) * v) / max;
    const x = pad + i * bw + 2;
    const last = i === vals.length - 1;
    s += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${COLOR[a.short]}" opacity="${last ? 1 : 0.38}"/>`;
    if (i >= vals.length - 2) s += `<text x="${(x + (bw - 4) / 2).toFixed(1)}" y="${(base - h - 3).toFixed(1)}" class="vl" text-anchor="middle">${Math.round(v)}</text>`;
    const [qq, fy] = qLabel(qs[i].label).split(" ");
    // The FY only under the first bar and each Q1, so the labels don't run together.
    s += `<text x="${(x + (bw - 4) / 2).toFixed(1)}" y="${base + 9}" class="ax" text-anchor="middle">${qq}</text>`;
    if (i === 0 || qq === "Q1") s += `<text x="${(x + (bw - 4) / 2).toFixed(1)}" y="${base + 17}" class="ax" text-anchor="middle">${fy}</text>`;
  });
  return `${s}</svg>`;
}

function indexLines(series: { label: string; color: string; pts: { date: string; value: number }[]; dash?: boolean }[], aria: string): string {
  const usable = series.filter((s) => s.pts.length > 1);
  if (!usable.length) return "";
  const W = 760,
    H = 230,
    L = 34,
    R = 120,
    T = 10,
    B = 22;
  const all = usable.flatMap((s) => s.pts.map((p) => p.value));
  const lo = Math.floor(Math.min(...all) / 5) * 5;
  const hi = Math.ceil(Math.max(...all) / 5) * 5 || lo + 5;
  const dates = [...new Set(usable.flatMap((s) => s.pts.map((p) => p.date)))].sort();
  const X = (d: string) => L + ((W - L - R) * dates.indexOf(d)) / Math.max(1, dates.length - 1);
  const Y = (v: number) => T + ((H - T - B) * (hi - v)) / Math.max(1, hi - lo);
  let s = `<svg viewBox="0 0 ${W} ${H}" class="wide" role="img" aria-label="${escapeHtml(aria)}">`;
  for (let v = lo; v <= hi; v += 5) s += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="grid"/><text x="${L - 4}" y="${(Y(v) + 3).toFixed(1)}" class="ax" text-anchor="end">${v}</text>`;
  const step = Math.ceil(dates.length / 6);
  dates.forEach((d, i) => {
    if (i % step === 0) s += `<text x="${X(d).toFixed(1)}" y="${H - 6}" class="ax" text-anchor="middle">${dd(d)}</text>`;
  });
  for (const sr of usable) {
    s += `<polyline fill="none" stroke="${sr.color}" stroke-width="${sr.dash ? 1.6 : 1.8}"${sr.dash ? ' stroke-dasharray="5 3"' : ""} points="${sr.pts.map((p) => `${X(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join(" ")}"/>`;
    const e = sr.pts.at(-1)!;
    s += `<circle cx="${X(e.date).toFixed(1)}" cy="${Y(e.value).toFixed(1)}" r="2.6" fill="${sr.color}"/>`;
  }
  const ends = usable.map((sr) => ({ sr, y: Y(sr.pts.at(-1)!.value) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 11) ends[i].y = ends[i - 1].y + 11;
  for (const { sr, y } of ends) s += `<text x="${W - R + 8}" y="${(y + 3).toFixed(1)}" class="lg" fill="${sr.color}">${escapeHtml(sr.label)} ${sr.pts.at(-1)!.value.toFixed(0)}</text>`;
  return `${s}</svg>`;
}

const SIP_BANDS = [
  { k: 2, label: "+2 SD", color: "#a30c15" },
  { k: 1, label: "+1 SD", color: "#e05a62" },
  { k: 0, label: "Mean", color: "#686b72" },
  { k: -1, label: "−1 SD", color: "#3fa45a" },
  { k: -2, label: "−2 SD", color: "#08711e" },
];

/** AMC Analytics' Industry SIP graph in YoY % mode: the line, its mean and ±1 / ±2 SD. */
function sipYoyChart(s: NonNullable<WeeklyReportData["industry"]["sipYoy"]>): string {
  if (s.mean == null || s.sd == null || s.points.length < 2) return "";
  const W = 760,
    H = 230,
    L = 40,
    R = 52,
    T = 10,
    B = 22;
  const bands = SIP_BANDS.map((b) => ({ ...b, v: s.mean! + b.k * s.sd! }));
  const all = [...s.points.map((p) => p.yoy), ...bands.map((b) => b.v)].map((v) => v * 100);
  const step = 10;
  const lo = Math.floor(Math.min(...all) / step) * step;
  const hi = Math.ceil(Math.max(...all) / step) * step;
  const X = (i: number) => L + ((W - L - R) * i) / (s.points.length - 1);
  const Y = (pct: number) => T + ((H - T - B) * (hi - pct)) / Math.max(1, hi - lo);
  let out = `<svg viewBox="0 0 ${W} ${H}" class="wide" role="img" aria-label="Industry SIP YoY %">`;
  for (let v = lo; v <= hi; v += step) out += `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="grid"/><text x="${L - 4}" y="${(Y(v) + 3).toFixed(1)}" class="ax" text-anchor="end">${v}%</text>`;
  for (const b of bands) {
    const y = Y(b.v * 100).toFixed(1);
    out += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${b.color}" stroke-width="1" ${b.k === 0 ? "" : 'stroke-dasharray="4 3"'}/><text x="${W - R + 4}" y="${(Number(y) + 3).toFixed(1)}" class="ax" fill="${b.color}">${b.label}</text>`;
  }
  s.points.forEach((p, i) => {
    if (i % 3 === 0 || i === s.points.length - 1) out += `<text x="${X(i).toFixed(1)}" y="${H - 6}" class="ax" text-anchor="middle">${MON[Number(p.month.slice(5, 7)) - 1]} ${p.month.slice(2, 4)}</text>`;
  });
  out += `<polyline fill="none" stroke="#1f63d6" stroke-width="2" points="${s.points.map((p, i) => `${X(i).toFixed(1)},${Y(p.yoy * 100).toFixed(1)}`).join(" ")}"/>`;
  const last = s.points.length - 1;
  out += `<circle cx="${X(last).toFixed(1)}" cy="${Y(s.points[last].yoy * 100).toFixed(1)}" r="3" fill="#1f63d6"/>`;
  return `${out}</svg>`;
}

function rangeBar(a: AmcWeekly): string {
  const t = a.targets.average;
  const cmp = a.price.close;
  if (t.bear == null || t.base == null || t.bull == null || cmp == null) return "";
  const W = 340,
    H = 64;
  const lo = Math.min(t.bear, cmp) * 0.97;
  const hi = Math.max(t.bull, cmp) * 1.03;
  const X = (v: number) => 10 + ((W - 20) * (v - lo)) / (hi - lo);
  const c = COLOR[a.short];
  return `<div class="rb"><div class="rbh">${amcName(a)} <span class="muted">Price ${rs(cmp)} · Base ${rs(t.base)} (${pct(a.targets.upside.base)})</span></div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(a.short)} target range"><rect x="${X(t.bear).toFixed(1)}" y="16" width="${(X(t.bull) - X(t.bear)).toFixed(1)}" height="22" rx="4" fill="${c}" opacity=".28"/>
<line x1="${X(t.base).toFixed(1)}" x2="${X(t.base).toFixed(1)}" y1="12" y2="42" stroke="${c}" stroke-width="3"/>
<line x1="${X(cmp).toFixed(1)}" x2="${X(cmp).toFixed(1)}" y1="6" y2="48" stroke="#333" stroke-width="1.2" stroke-dasharray="2 2"/>
<text x="${X(t.bear).toFixed(1)}" y="58" class="ax">Bear ${rs(t.bear)}</text><text x="${X(t.bull).toFixed(1)}" y="58" class="ax" text-anchor="end">Bull ${rs(t.bull)}</text></svg></div>`;
}

// ---------- commentary ----------
function bullets(list: CommentaryBullet[] | undefined): string {
  if (!list?.length) return "";
  return `<ul class="b">${list.map((b) => `<li>${b.lead ? `<b>${escapeHtml(b.lead)}</b> ` : ""}${escapeHtml(b.text)}</li>`).join("")}</ul>`;
}

const section = (c: WeeklyCommentary | null, key: CommentarySection) => bullets(c?.sections[key]);

/** Highest first on `key`; AMCs with no figure go last, ties keep the AMC Analytics tab order. */
export function sortDesc(amcs: AmcWeekly[], key: (a: AmcWeekly) => number | null | undefined): AmcWeekly[] {
  const v = (a: AmcWeekly) => {
    const x = key(a);
    return x == null || !Number.isFinite(x) ? -Infinity : x;
  };
  return [...amcs].sort((x, y) => v(y) - v(x));
}

/** Target-year PAT growth (e.g. FY29E over FY28E). */
export function targetYearGrowth(a: AmcWeekly, targetFy: number): number | null {
  const cur = a.earnings.pat[targetFy];
  const prev = a.earnings.pat[targetFy - 1];
  return cur != null && prev ? cur / prev - 1 : null;
}

// ---------- page ----------
export interface RenderOptions {
  /** Built from /admin's "Generate report now": live figures, no commentary, with any blocking problems listed. */
  onDemand?: { problems: string[] };
}

export function renderWeeklyReportHtml(data: WeeklyReportData, commentary: WeeklyCommentary | null, opts: RenderOptions = {}): string {
  const A = data.amcs;
  const I = data.industry;
  const fy = `FY${String(data.targetFy).slice(2)}E`;
  const qCur = qLabel(data.quarter.label);
  const qPrev = qLabel(data.quarter.prevLabel);
  const days = data.quarter.sessions;
  const asOfText = ddy(data.asOf);
  const qsDate = A.find((a) => a.price.quarterStartDate)?.price.quarterStartDate ?? null;
  const checked = commentary?.check?.verdict === "pass";
  const banner = opts.onDemand
    ? `<div class="draft"><b>Generated on demand</b> from the dashboard's live data to ${ddy(data.asOf)}: figures, tables and charts only. The written commentary and its number check are added by the Saturday run.${opts.onDemand.problems.length ? `<br><b>Check before relying on it:</b> ${escapeHtml(opts.onDemand.problems.join("; "))}.` : ""}</div>`
    : !commentary
    ? `<div class="draft">Figures only: the commentary has not been written yet.</div>`
    : !checked
      ? `<div class="draft"><b>DRAFT.</b> The commentary has not passed the number check; treat its figures with care.</div>`
      : "";

  // Every table lists its AMCs by its own growth / upside column, highest first.
  const byQoq = sortDesc(A, (a) => a.aum.qoq);
  const t1 =
    byQoq.map(
      (a) =>
        `<tr><td>${amcName(a)}${a.blended ? "<sup>*</sup>" : ""}</td><td class="num">${inr(a.aum.qPrev.value)}</td><td class="num">${inr(a.aum.qCur.value)} <span class="d">(${a.aum.qCur.days} d)</span></td>${cp(a.aum.qoq)}${cp(a.aum.yoy)}<td class="num">${inr(a.aum.mPrev.value)}</td><td class="num">${inr(a.aum.mCur.value)}</td>${cp(a.aum.mom)}${cp(a.aum.mYoyChg)}${cp(a.aum.projectedQoq)}</tr>`
    ).join("") +
    `<tr class="tot"><td>Industry equity</td><td class="num">${inr(I.quarters.at(-2)?.value)}</td><td class="num">${inr(I.quarters.at(-1)?.value)} <span class="d">(${I.quarters.at(-1)?.days ?? "–"} d)</span></td>${cp(I.qoq)}${cp(I.yoy)}<td class="num">${inr(I.mPrev)}</td><td class="num">${inr(I.mCur)}</td>${cp(I.mom)}<td class="num">–</td>${cp(I.projectedQoq)}</tr>`;

  const shareLabels = A[0]?.share.quarters.map((x) => x.label) ?? [];
  const t2 =
    sortDesc(A, (a) => a.share.qoqBps)
      .map(
        (a) =>
          `<tr><td>${amcName(a)}</td>${shareLabels.map((l) => `<td class="num">${sharePct(a.share.quarters.find((x) => x.label === l)?.share)}</td>`).join("")}<td class="num ${tone(a.share.qoqBps == null ? null : a.share.qoqBps / 10000)}">${bps(a.share.qoqBps)}</td><td class="num">${sharePct(a.share.last5)}</td>${cp(a.share.growthVsIndustry)}</tr>`
      )
      .join("") +
    `<tr class="tot"><td>Industry, ₹ lakh Cr</td>${shareLabels.map((l) => `<td class="num">${((I.quarters.find((q) => q.label === l)?.value ?? NaN) / 100000).toFixed(2)}</td>`).join("")}${cp(I.qoq)}<td class="num">${I.last5 == null ? "–" : (I.last5 / 100000).toFixed(2)}</td><td class="num">–</td></tr>`;

  const sipLabels = A.find((a) => a.sip)?.sip?.quarters.map((q) => q.label) ?? [];
  const t3a = `<tr><td>SIP contributions</td>${data.flows.map((f) => `<td class="num">${inr(f.sipCr)}</td>`).join("")}</tr><tr><td>Equity net flows</td>${data.flows.map((f) => `<td class="num">${inr(f.equityNetCr)}</td>`).join("")}</tr>`;
  const fHead = data.flows.map((f) => `<th class="num">${monYy(f.month)}</th>`).join("");
  const t3b = sortDesc(A, (a) => a.sip?.yoy).map((a) => {
    const qs = a.sip?.quarters ?? [];
    const latestPct = qs.at(-1)?.sipEqAumPct;
    return `<tr><td>${amcName(a)}</td>${sipLabels.map((_, i) => `<td class="num">${inr(qs[i]?.sipCr)}</td>`).join("")}${cp(a.sip?.qoq)}${cp(a.sip?.yoy)}<td class="num">${latestPct == null ? "–" : `${(latestPct * 100).toFixed(1)}%`}</td><td class="num">${a.score?.latest == null ? "–" : a.score.latest.toFixed(2)}</td>${cp(a.score?.vs1yAgo)}</tr>`;
  }).join("");

  const t4 =
    sortDesc(A, (a) => a.aum.wow).map(
      (a) =>
        `<tr><td>${amcName(a)}</td><td class="num">${inr(a.aum.last5)}</td><td class="num">${inr(a.aum.prev5)}</td>${cp(a.aum.wow)}<td class="num">${inr(a.aum.last20)}</td><td class="num">${inr(a.aum.last45)}</td>${cp(a.aum.last5Vs45)}<td class="num">${sharePct(a.share.last5)}</td></tr>`
    ).join("") +
    `<tr class="tot"><td>Industry equity</td><td class="num">${inr(I.last5)}</td><td class="num">${inr(I.prev5)}</td>${cp(I.wow)}<td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="num">100%</td></tr>`;
  const toIndex = (rows: { date: string; value: number }[]) => (rows[0]?.value ? rows.map((p) => ({ date: p.date, value: (p.value / rows[0].value) * 100 })) : []);
  const aumIdx = indexLines(
    [
      ...A.map((a) => ({ label: a.short, color: COLOR[a.short], pts: toIndex(a.aum.daily) })),
      { label: "Industry", color: "#6b7280", pts: toIndex(I.daily), dash: true },
    ],
    "Daily equity AUM indexed"
  );
  const tGap =
    sortDesc(A, (a) => a.price.vsAum)
      .map(
        (a) =>
          `<tr><td>${amcName(a)}${a.blended ? "<sup>*</sup>" : ""}</td>${cp(a.aum.sinceQuarterStart)}${cp(a.price.sinceQuarterStart)}${cp(a.price.vsAum)}<td class="num">${a.price.indexHigh ? `${a.price.indexHigh.value.toFixed(0)} <span class="d">(${dd(a.price.indexHigh.date)})</span>` : "–"}</td><td class="num">${a.price.indexLow ? `${a.price.indexLow.value.toFixed(0)} <span class="d">(${dd(a.price.indexLow.date)})</span>` : "–"}</td></tr>`
      )
      .join("") + `<tr class="tot"><td>Industry equity</td>${cp(I.sinceQuarterStart)}<td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="num">–</td></tr>`;

  const fv = data.fitView;
  const t5 = sortDesc(A, (a) => a.ratio?.meanVsPrice).map((a) => {
    const r = a.ratio;
    if (!r) return `<tr><td>${amcName(a)}</td><td colspan="10" class="d">Not enough history in the saved range</td></tr>`;
    const lv = (k: number) => r.levels.find((l) => l.sd === k);
    return `<tr><td>${amcName(a)}</td><td class="num">${rs(a.price.close)}</td>${[-2, -1, 0, 1, 2].map((k) => `<td class="num${k === 0 ? " mean" : ""}">${rs(lv(k)?.price)}</td>`).join("")}${cp(r.meanVsPrice)}<td class="num">${sd(r.zScore)}</td><td class="num">${r.corr == null ? "–" : `${(r.corr * 100).toFixed(1)}%`}</td><td class="num">${r.r2 == null ? "–" : `${(r.r2 * 100).toFixed(1)}%`}</td></tr>`;
  }).join("");

  const t6 = sortDesc(A, (a) => a.regression?.vsPrice).map((a) => {
    const g = a.regression;
    return `<tr><td>${amcName(a)}</td><td class="num">${rs(a.price.close)}</td><td class="num">${rs(g?.target)}</td>${cp(g?.vsPrice)}<td class="num">${g?.corr == null ? "–" : `${(g.corr * 100).toFixed(1)}%`}</td><td class="num">${g?.r2 == null ? "–" : `${(g.r2 * 100).toFixed(1)}%`}</td></tr>`;
  }).join("");

  const patYears = Object.keys(A[0]?.earnings.pat ?? {}).map(Number).sort();
  const t7 = sortDesc(A, (a) => targetYearGrowth(a, data.targetFy)).map((a) => {
    const e = a.earnings;
    const growth = patYears.slice(1).map((y) => cp(e.pat[y] != null && e.pat[y - 1] ? e.pat[y]! / e.pat[y - 1]! - 1 : null));
    const z = e.peZ;
    return `<tr><td>${amcName(a)}</td>${patYears.map((y) => `<td class="num">${inr(e.pat[y])}</td>`).join("")}${growth.join("")}<td class="num">${e.epsTargetFy == null ? "–" : e.epsTargetFy.toFixed(1)}</td><td class="num">${e.peNow == null ? "–" : `${e.peNow.toFixed(1)}x`}</td><td class="num">${e.peMean == null ? "–" : `${e.peMean.toFixed(1)}x`} <span class="d">(SD ${e.peSd == null ? "–" : e.peSd.toFixed(1)})</span></td><td class="num ${z == null ? "" : z > 1 ? "neg" : z < -1 ? "pos" : ""}">${sd(z)}</td></tr>`;
  }).join("");
  const fyName = (y: number) => `FY${String(y).slice(2)}${y <= 2026 ? "A" : "E"}`;

  const M: [keyof AmcWeekly["targets"]["methods"], string][] = [
    ["ratio", "Ratio"],
    ["bestFit", "Best fit"],
    ["pe", `PE (${fy})`],
    ["mcapSales", `Mcap/Sales (${fy})`],
  ];
  // AMCs without a PAT estimate (targets on Ratio + Best fit only) go last: not comparable.
  const byUpside = sortDesc(A, (a) => (a.targets.noPat ? null : a.targets.upside.base));
  const t8 = byUpside.map((a) => {
    const T = a.targets;
    const rows = M.map(([k, l]) => {
      const m = T.methods[k];
      return `<td class="m">${l} <span class="d">(${m.share == null ? "–" : `${Math.round(m.share * 100)}%`})</span></td><td class="num">${rs(m.bear)}</td><td class="num">${rs(m.base)}</td><td class="num">${rs(m.bull)}</td>${cp(m.upside)}`;
    });
    rows.push(`<td class="m"><b>Target (weighted)</b></td><td class="num"><b>${rs(T.average.bear)}</b></td><td class="num"><b>${rs(T.average.base)}</b></td><td class="num"><b>${rs(T.average.bull)}</b></td>${cp(T.upside.base)}`);
    return rows
      .map(
        (r, i) =>
          `<tr class="${i === rows.length - 1 ? "tgt" : ""}">${i === 0 ? `<td rowspan="${rows.length}" class="co">${amcName(a)}<div class="d">${escapeHtml(a.tradingSymbol)}</div>${T.noPat ? `<div class="d">no ${fy} PAT saved</div>` : ""}</td><td rowspan="${rows.length}" class="num">${rs(a.price.close, 2)}</td><td rowspan="${rows.length}" class="num ${tone(a.price.weekChg)}">${pct(a.price.weekChg)}</td><td rowspan="${rows.length}" class="num ${tone(a.price.sinceQuarterStart)}">${pct(a.price.sinceQuarterStart)}</td>` : ""}${r}</tr>`
      )
      .join("");
  }).join("");
  const pxIdx = indexLines(A.map((a) => ({ label: a.short, color: COLOR[a.short], pts: a.price.indexed })), "Share prices indexed");
  const noPat = A.filter((a) => a.targets.noPat).map((a) => a.short);

  const nextWeekItems = data.nextWeek.items.map((i) => ({ lead: i.title + ":", text: i.detail }));
  const nextWeek = commentary?.nextWeek?.length ? commentary.nextWeek : nextWeekItems;
  const takeaways = commentary?.takeaways?.length
    ? bullets(commentary.takeaways)
    : `<p class="d">${opts.onDemand ? "Written by the Saturday run; this on-demand version has the figures only." : "Commentary pending: the tables below are complete."}</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(weeklyReportFileBase(data.asOf))}</title>
<style>
:root{--navy:#1d3557;--ink:#1f2933;--muted:#6b7280;--rule:#d6dbe3;--pos:#1a8a3a;--neg:#cf2e2e;--box:#eef4fb;--blue:#2f80d1}
*{box-sizing:border-box}body{margin:0;background:#e9ecf1;color:var(--ink);font:13px/1.5 -apple-system,"Helvetica Neue",Arial,sans-serif}
.page{max-width:900px;margin:18px auto;background:#fff;padding:26px 30px 34px;box-shadow:0 1px 4px rgba(0,0,0,.12)}
.draft{background:#fff7d6;border:1px solid #e9c46a;color:#7a5b00;font-size:12px;padding:8px 12px;border-radius:4px;margin-bottom:14px}
header{background:var(--navy);color:#fff;padding:20px 24px;border-radius:3px}header h1{margin:0 0 6px;font-size:22px;line-height:1.25}header p{margin:2px 0;color:#d5deea}header .s{font-size:11.5px;color:#aebbd0}
.kt{background:var(--box);border-left:5px solid var(--blue);padding:12px 20px 8px;margin:18px 0}.kt h2{margin:0 0 6px;color:var(--blue);font-size:15px;border:0;padding:0}
h3{font-size:14px;color:var(--navy);margin:16px 0 4px}
h2{font-size:18px;color:var(--navy);border-bottom:2px solid var(--rule);padding-bottom:5px;margin:26px 0 10px}
table{width:100%;border-collapse:collapse;font-size:12.3px;margin:6px 0}th{background:var(--navy);color:#fff;font-weight:600;padding:6px 7px;text-align:left}th.num,td.num{text-align:right;white-space:nowrap}
td{padding:5px 7px;border-bottom:1px solid #e5e8ee}tr.tot td{font-weight:700;background:#f3f5f8}tr.tgt td{background:#f3f6fa}td.co{vertical-align:middle;background:#fff}td.mean{font-weight:700}
.pos{color:var(--pos);font-weight:600}.neg{color:var(--neg);font-weight:600}.d{color:var(--muted);font-size:11px;font-weight:400}.amc{font-weight:700;white-space:nowrap}tr.tot td:first-child{white-space:nowrap}.muted{color:var(--muted);font-weight:400;font-size:11.5px}
.statline{font-size:12px;color:var(--muted);margin:10px 0 0}.statline b{color:var(--ink)}
.cap{font-style:italic;color:var(--muted);font-size:11.3px;margin:4px 0 8px}ul.b{padding-left:18px;margin:6px 0}ul.b li{margin:0 0 6px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 14px}.grid4 h4{margin:6px 0 0;font-size:12.5px}
svg .grid{stroke:#e6e9ef}svg .ax{font-size:8.5px;fill:#8a93a3}svg .vl{font-size:9px;font-weight:700;fill:#333}svg .lg{font-size:10.5px;font-weight:700}svg.mini,svg.wide{width:100%;height:auto}
.rbs{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px}.rb svg{width:100%;height:auto}.rbh{font-size:12px;margin-top:6px}
.foot{font-size:11px;color:var(--muted);font-style:italic;margin-top:18px;border-top:1px solid var(--rule);padding-top:8px}
.tw{overflow-x:auto}
@media (max-width:700px){.page{padding:16px;margin:0}.grid4{grid-template-columns:repeat(2,1fr)}.rbs{grid-template-columns:1fr}table{font-size:11px}}
@page{size:A4;margin:12mm 11mm}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;padding:0}h2,h3,.statline{break-after:avoid}tr,.grid4,.rbs,svg,.fig,ul.b li,table:not(.tall){break-inside:avoid}.cap{break-before:avoid}.tw{overflow:visible}}
</style></head><body><div class="page">
${banner}
<header><h1>AMC Update: ${A.map((a) => escapeHtml(a.short === "Motilal" ? "Motilal Oswal" : a.short)).join(" · ")}</h1>
<p>Equity AUM run-rate, market share, flows, valuation models and target prices</p>
<p class="s">Data to the close of ${asOfText} · AUM = average daily equity AUM, ₹ Cr · AUM after the latest monthly disclosure is the dashboard's live estimate; pre-2026 AUM is modelled · valuation from the AMC Analytics tab (${fy})</p></header>

<div class="kt"><h2>Key takeaways</h2>${takeaways}</div>

<h2>1. Equity AUM run-rate</h2>
<div class="tw"><table><thead><tr><th>₹ Cr, average daily AUM</th><th class="num">${qPrev}</th><th class="num">${qCur} QTD</th><th class="num">QoQ</th><th class="num">YoY</th><th class="num">${mLabel(data.month.prevLabel)}</th><th class="num">${mLabel(data.month.label)}</th><th class="num">MoM</th><th class="num">${mLabel(data.month.label)} YoY</th><th class="num">${qCur} if ${mLabel(data.month.label)} holds</th></tr></thead><tbody>${t1}</tbody></table></div>
<div class="cap">Every figure is an average of daily AUM (the AUM Summary ledger's method), not an exit figure. QoQ = ${qCur} average so far (${days} sessions) ÷ ${qPrev} average − 1. YoY = ${qCur} average so far ÷ the full ${qLabel(data.quarter.yoyLabel)} average (${A[0]?.aum.qYoy.days ?? "–"} sessions; modelled AUM before 2026) − 1. ${mLabel(data.month.label)} YoY = ${mLabel(data.month.label)} average so far ÷ the ${mLabel(data.month.label)} ${Number(data.asOf.slice(0, 4)) - 1} average − 1. Last column: QoQ if the ${mLabel(data.month.label)} average holds for the ${data.quarter.sessionsLeft} sessions left in the quarter. * Nippon is equity + gold/silver ETF AUM, as the AMC Analytics tab shows it by default. Rows sorted by QoQ, highest first.</div>
<div class="fig"><div class="grid4">${byQoq.map((a) => `<div><h4 style="color:${COLOR[a.short]}">${escapeHtml(a.short)}</h4>${quarterBars(a)}</div>`).join("")}</div>
<div class="cap">Average daily equity AUM by quarter, ₹ '000 Cr. Current quarter (${qCur}, ${days} sessions to ${dd(data.asOf)}) in full colour.</div></div>
${section(commentary, "aum")}

<h2>2. AUM vs share price this quarter</h2>
<div class="fig"><h3>Exit equity AUM this quarter (daily)</h3>
${aumIdx}
<div class="cap">Each day's exit equity AUM (that day's AUM, not an average) indexed to ${qsDate ? ddy(qsDate) : "the previous quarter's last session"} = 100, the previous quarter's last session; dashed grey = industry equity. Nippon includes its gold/silver ETFs.</div></div>
${section(commentary, "aumPath")}
<div class="fig"><h3>Share prices this quarter</h3>
${pxIdx}
<div class="cap">Closing share prices indexed to ${qsDate ? ddy(qsDate) : "the previous quarter's last close"} = 100.</div></div>
<div class="tw"><table><thead><tr><th>${qsDate ? dd(qsDate) : "Quarter start"} → ${dd(data.asOf)}</th><th class="num">Exit AUM</th><th class="num">Share price</th><th class="num">Price vs exit AUM</th><th class="num">Price high (index)</th><th class="num">Price low (index)</th></tr></thead><tbody>${tGap}</tbody></table></div>
<div class="cap">Point to point, ${qsDate ? dd(qsDate) : "quarter start"} → ${dd(data.asOf)}: Exit AUM = AUM on ${dd(data.asOf)} ÷ AUM on ${qsDate ? dd(qsDate) : "the quarter start"} − 1 (single days, not averages, to match the share price's closes). Price vs exit AUM = (1 + price change) ÷ (1 + exit AUM change) − 1: positive means the share price has run ahead of the AMC's AUM (the market pays more per rupee of AUM), negative means it has lagged. Rows sorted by Price vs exit AUM. Section 1's QoQ uses average daily AUM instead, so the two differ.</div>
${section(commentary, "pricePath")}

<h2>3. Market share of industry equity AUM</h2>
<div class="tw"><table><thead><tr><th>Share of industry, average AUM</th>${shareLabels.map((l, i) => `<th class="num">${qLabel(l)}${i === shareLabels.length - 1 ? " QTD" : ""}</th>`).join("")}<th class="num">QoQ</th><th class="num">Last 5 d</th><th class="num">Growth vs industry</th></tr></thead><tbody>${t2}</tbody></table></div>
<div class="cap">Each AMC's equity AUM (equity only, Nippon too) ÷ the dashboard's industry equity total, as quarterly averages. Growth vs industry = AMC QoQ − industry QoQ. Rows sorted by the QoQ change in share.</div>
${section(commentary, "share")}

<h2>4. Flows, SIP and AMC Score</h2>
<div class="tw"><table><thead><tr><th>Industry, ₹ Cr (AMFI)</th>${fHead}</tr></thead><tbody>${t3a}</tbody></table></div>
${
  I.sipYoy && I.sipYoy.mean != null
    ? `<div class="fig"><p class="statline"><b>Industry SIP contributions, YoY %</b> · Mean YoY ${(I.sipYoy.mean * 100).toFixed(1)}% · Current ${I.sipYoy.current == null ? "–" : `${(I.sipYoy.current * 100).toFixed(1)}%`} (${I.sipYoy.currentMonth ? monYy(`${I.sipYoy.currentMonth}-01`) : "–"}) · Z-score <span class="${tone(I.sipYoy.z == null ? null : -I.sipYoy.z)}">${I.sipYoy.z == null ? "–" : `${I.sipYoy.z >= 0 ? "+" : "−"}${Math.abs(I.sipYoy.z).toFixed(2)}σ`}</span> · ${I.sipYoy.months} months</p>${sipYoyChart(I.sipYoy)}<div class="cap">AMFI monthly SIP contributions against the same month a year earlier, over the last ${I.sipYoy.months} months, with the mean and ±1 / ±2 SD (population): the AMC Analytics Industry SIP graph's ${Math.round(I.sipYoy.months / 12)}Y view in YoY % mode.</div></div>`
    : ""
}
<div class="tw"><table><thead><tr><th>AMC SIP book, ₹ Cr / month</th>${sipLabels.map((l) => `<th class="num">${l}</th>`).join("")}<th class="num">QoQ</th><th class="num">YoY</th><th class="num">SIP / Eq AUM</th><th class="num">AMC Score</th><th class="num">vs 1Y ago</th></tr></thead><tbody>${t3b}</tbody></table></div>
<div class="cap">AMC SIP and AMC Score from the AMC Analytics tab's SIP &amp; Score section; the score is its 6-month average. Rows sorted by SIP YoY; AMCs without SIP data last.</div>
${section(commentary, "flows")}

<h2>5. This week</h2>
<div class="tw"><table><thead><tr><th>₹ Cr, average daily AUM</th><th class="num">Last 5</th><th class="num">Prev 5</th><th class="num">Change</th><th class="num">Last 20</th><th class="num">Last 45</th><th class="num">Last 5 vs 45</th><th class="num">Share, last 5</th></tr></thead><tbody>${t4}</tbody></table></div>
<div class="cap">Last 5 vs previous 5 trading sessions, as in the AUM Summary ledger (Muhurat and DR-test sessions excluded). Rows sorted by the week's change.</div>
${section(commentary, "week")}

<h2>6. Ratio ladder</h2>
<div class="tw"><table><thead><tr><th>Price at ratio level</th><th class="num">Price</th><th class="num">−2 SD</th><th class="num">−1 SD</th><th class="num">Mean</th><th class="num">+1 SD</th><th class="num">+2 SD</th><th class="num">Mean vs price</th><th class="num">Now</th><th class="num">Corr</th><th class="num">R²</th></tr></thead><tbody>${t5}</tbody></table></div>
<div class="cap">The Ratio section's saved view: ${escapeHtml(fv.range.toUpperCase())} · moving avg ${fv.maDays}D${fv.aumOnlyAveraging ? " (AUM only)" : ""} · ${fv.levelsCorrelation ? "levels" : "daily % change"} correlation. Price = (mean ratio ± k·SD) × today's AUM; Mean vs price = mean-ratio price ÷ close − 1 (sorted on it).</div>
${section(commentary, "ratio")}

<h2>7. Regression</h2>
<div class="tw"><table><thead><tr><th>₹ per share</th><th class="num">Price</th><th class="num">Regression</th><th class="num">vs price</th><th class="num">Corr</th><th class="num">R²</th></tr></thead><tbody>${t6}</tbody></table></div>
<div class="cap">The Regression section's saved view (${escapeHtml(fv.range.toUpperCase())} · moving avg ${fv.maDays}D · ${fv.levelsCorrelation ? "price on the AUM level" : "daily % change model"}), sorted by vs price.</div>
${section(commentary, "regression")}

<h2>8. Earnings and PE</h2>
<div class="tw"><table><thead><tr><th>PAT, ₹ Cr</th>${patYears.map((y) => `<th class="num">${fyName(y)}</th>`).join("")}${patYears.slice(1).map((y) => `<th class="num">${fyName(y).slice(0, 4)} g</th>`).join("")}<th class="num">${fy} EPS</th><th class="num">PE now</th><th class="num">${escapeHtml(data.peRange.toUpperCase())} mean</th><th class="num">vs mean</th></tr></thead><tbody>${t7}</tbody></table></div>
<div class="cap">All from the AMC Analytics Valuation Model: PAT estimates and shares from its inputs, the ${fy} target year from its year switch, trailing PE from its PE series (Ace Equity uploads; provisional days after the last upload), with its mean and SD over the PE band chart's default ${escapeHtml(data.peRange.toUpperCase())} window. Rows sorted by ${fy.slice(0, 4)} PAT growth; AMCs without it last.</div>
${section(commentary, "earnings")}

<h2>9. Share prices vs targets</h2>
<div class="tw"><table class="tall"><thead><tr><th>AMC</th><th class="num">Price ${dd(data.asOf)}</th><th class="num">Week</th><th class="num">Since ${qsDate ? dd(qsDate) : "quarter start"}</th><th>Method (weight)</th><th class="num">Bear</th><th class="num">Base</th><th class="num">Bull</th><th class="num">Base vs price</th></tr></thead><tbody>${t8}</tbody></table></div>
<div class="cap">The Valuation Model's Target Price table on ${fy}: saved weights (Ratio ${data.weights.ratio} / Best fit ${data.weights.bestFit} / PE ${data.weights.pe} / Mcap-Sales ${data.weights.mcapSales}) rescaled over the methods with a price, shown in brackets. AMCs sorted by Base vs price; those without a ${fy} PAT estimate last.${noPat.length ? ` ${escapeHtml(noPat.join(", "))}: no ${fy} PAT estimate saved, so PE and Mcap/Sales drop out.` : ""}</div>
<div class="fig"><div class="rbs">${byUpside.map(rangeBar).join("")}</div>
<div class="cap">Bear–Bull range of the weighted target, Base marked; dashed line = latest close.</div></div>
${section(commentary, "targets")}

<h2>10. Next week (${shortDate(data.nextWeek.from)} – ${shortDate(data.nextWeek.to)})</h2>
${bullets(nextWeek) || `<p class="d">Nothing scheduled that changes the dashboard's figures.</p>`}

<div class="foot">Sources: AMC dashboard (amc-live-aum-tracker), AMC Analytics tab data as of ${asOfText}: /api/amc-stock-correlations, /api/aum-history-range (Industry Total), /api/amc-analytics/inputs, /api/amc-analytics/target-year, /api/amc-valuation, /api/amc-analytics/amc-score, /api/industry-monthly-flows, /api/sip-quarterly; saved Target Price, Ratio and Regression settings. Generated ${escapeHtml(data.generatedAt.slice(0, 16).replace("T", " "))} UTC.${commentary?.check ? ` Commentary number check: ${escapeHtml(commentary.check.verdict)}.` : ""}</div>
</div></body></html>`;
}
