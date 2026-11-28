import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getFiscalQuarterBounds } from "../../src/lib/aum/report-period";
import { addDaysToDateString, getIstDateString } from "../../src/lib/utils/date";
import { buildWeeklyReportData, figureProblems } from "../../src/lib/reports/weekly/compute";
import { renderWeeklyReportHtml } from "../../src/lib/reports/weekly/render";
import type { RawReportInputs, WeeklyCommentary, WeeklyReportData } from "../../src/lib/reports/weekly/types";
import { verifyCommentary } from "../../src/lib/reports/weekly/verify";

// agent-cli's `report` subcommands: the Saturday AMC Weekly Update.
//
//   report figures [YYYY-MM-DD]   GET the AMC Analytics tab's payloads from production, compute, write figures.json
//   report verify  [YYYY-MM-DD]   resolve every commentary ref and match the numbers in its text (no writes)
//   report stamp   <YYYY-MM-DD> <pass|fail> [notes]   record the check verdict ("pass" only if verify is clean)
//   report render  [YYYY-MM-DD]   figures.json + commentary.json → HTML + PDF (also copied to the reports folder)
//   report publish [YYYY-MM-DD]   upload the checked report to the dashboard's admin Reports page
//
// Work files live in .claude/weekly-reports/<as-of>/ (gitignored: the repo
// is public); finished reports are copied to WEEKLY_REPORT_DIR.

const PROD_URL = process.env.OPS_APP_URL ?? "https://amc-live-aum-tracker.vercel.app";
const WORK_DIR = resolve(process.cwd(), ".claude/weekly-reports");
const OUT_DIR = process.env.WEEKLY_REPORT_DIR ?? join(homedir(), "Documents", "Claude Working Folder", "AMC Weekly Reports");
const CHROME_PATHS = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET only: the report never writes through the data endpoints (several also accept POST). */
async function getJson<T>(path: string): Promise<T> {
  if (/refresh=1|\/api\/live-aum|\/api\/admin\/|\/api\/fortnightly-update/.test(path)) throw new Error(`refusing to fetch ${path}`);
  const res = await fetch(`${PROD_URL}${path}`, { method: "GET", headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function folderFor(asOf: string): string {
  return join(WORK_DIR, asOf);
}

/** The newest report folder, or the one for the given date. */
function resolveFolder(dateArg?: string): { asOf: string; dir: string } {
  if (dateArg) {
    if (!DATE_RE.test(dateArg)) throw new Error("date must be YYYY-MM-DD");
    return { asOf: dateArg, dir: folderFor(dateArg) };
  }
  const dates = existsSync(WORK_DIR) ? readdirSync(WORK_DIR).filter((d) => DATE_RE.test(d)).sort() : [];
  if (!dates.length) throw new Error("no report folder yet: run `report figures` first");
  const asOf = dates.at(-1)!;
  return { asOf, dir: folderFor(asOf) };
}

function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}

/** Fetch the AMC Analytics payloads (GET only) and compute the figures, with the run's blocking problems. */
async function computeFigures(requested: string): Promise<{ data: WeeklyReportData; problems: string[] }> {
  const listedRaw = await getJson<{ amcs: { id: number; slug: string; overviewName: string }[] }>("/api/listed-amcs");
  const nippon = listedRaw.amcs.find((a) => a.slug === "nippon-india-mutual-fund");
  const rangeFrom = addDaysToDateString(getFiscalQuarterBounds(requested).start, -460);
  const [correlations, range, targetYear, flows, sipQuarterly] = await Promise.all([
    getJson<RawReportInputs["correlations"]>(`/api/amc-stock-correlations${nippon ? `?blendGoldSilverAmcIds=${nippon.id}` : ""}`),
    getJson<{ rows: RawReportInputs["industryRange"] }>(`/api/aum-history-range?from=${rangeFrom}&to=${requested}`),
    getJson<{ fiscalYear: number }>("/api/amc-analytics/target-year"),
    getJson<{ points: RawReportInputs["flows"] }>("/api/industry-monthly-flows"),
    getJson<{ amcs: RawReportInputs["sipQuarterly"] }>("/api/sip-quarterly"),
  ]);
  const perAmc: RawReportInputs["perAmc"] = {};
  for (const a of listedRaw.amcs) {
    const [inputs, valuation, score] = await Promise.all([
      getJson<RawReportInputs["perAmc"][string]["inputs"]>(`/api/amc-analytics/inputs?amcId=${a.id}`),
      getJson<RawReportInputs["perAmc"][string]["valuation"]>(`/api/amc-valuation?slug=${encodeURIComponent(a.slug)}`),
      getJson<RawReportInputs["perAmc"][string]["score"]>(`/api/amc-analytics/amc-score?amcId=${a.id}`),
    ]);
    perAmc[a.slug] = { inputs, valuation, score };
  }
  const data = buildWeeklyReportData(
    { listed: listedRaw.amcs, correlations, industryRange: range.rows, targetFy: targetYear.fiscalYear, flows: flows.points, sipQuarterly: sipQuarterly.amcs, perAmc },
    requested,
    new Date().toISOString()
  );
  return { data, problems: figureProblems(data) };
}

/** The figures without their run timestamps, for comparing two runs. */
function figuresKey(data: WeeklyReportData): string {
  return JSON.stringify({ ...data, generatedAt: null, sourceComputedAt: null });
}

/** What a "pass" stamp vouches for: these exact figures and this exact commentary text. */
function contentHash(data: WeeklyReportData, commentary: WeeklyCommentary): string {
  return createHash("sha256").update(figuresKey(data)).update("\n").update(JSON.stringify({ ...commentary, check: null })).digest("hex");
}

export async function reportFigures(dateArg?: string) {
  const requested = dateArg ?? getIstDateString();
  if (!DATE_RE.test(requested)) throw new Error("date must be YYYY-MM-DD");
  const { data, problems } = await computeFigures(requested);
  const dir = folderFor(data.asOf);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "figures.json"), JSON.stringify(data, null, 1));
  console.log(JSON.stringify({ asOf: data.asOf, folder: dir, amcs: data.amcs.length, warnings: data.warnings, problems }, null, 2));
  if (problems.length) process.exitCode = 1;
}

export async function reportVerify(dateArg?: string) {
  const { dir } = resolveFolder(dateArg);
  const data = readJson<WeeklyReportData>(join(dir, "figures.json"));
  const commentary = readJson<WeeklyCommentary>(join(dir, "commentary.json"));
  if (!data) throw new Error(`no figures.json in ${dir}`);
  if (!commentary) throw new Error(`no commentary.json in ${dir}`);
  const result = verifyCommentary(data, commentary);
  console.log(JSON.stringify(result, null, 2));
  if (result.summary.badRefs > 0 || result.summary.unmatched > 0) process.exitCode = 1;
}

export async function reportStamp(dateArg: string | undefined, verdict: string | undefined, notes?: string) {
  if (!dateArg || (verdict !== "pass" && verdict !== "fail")) throw new Error("usage: report stamp <YYYY-MM-DD> <pass|fail> [notes]");
  const { dir } = resolveFolder(dateArg);
  const file = join(dir, "commentary.json");
  const data = readJson<WeeklyReportData>(join(dir, "figures.json"));
  const commentary = readJson<WeeklyCommentary>(file);
  if (!data || !commentary) throw new Error(`figures.json and commentary.json are both needed in ${dir}`);
  if (verdict === "pass") {
    const { summary } = verifyCommentary(data, commentary);
    if (summary.unmatched > 0 || summary.badRefs > 0) throw new Error(`not stamping pass: ${summary.unmatched} unmatched numbers, ${summary.badRefs} bad refs (run report verify)`);
  }
  commentary.check = { verdict, checkedAt: new Date().toISOString(), hash: contentHash(data, commentary), ...(notes ? { notes: notes.slice(0, 200) } : {}) };
  writeFileSync(file, JSON.stringify(commentary, null, 1));
  console.log(JSON.stringify({ file, check: commentary.check }, null, 2));
}

function findChrome(): string {
  const found = CHROME_PATHS.find((p): p is string => Boolean(p) && existsSync(p!));
  if (!found) throw new Error("Chrome not found: set CHROME_PATH to a Chrome/Chromium binary");
  return found;
}

/** Writes the HTML and prints it to PDF in `dir`; returns both paths. */
function renderFiles(dir: string, asOf: string, data: WeeklyReportData, commentary: WeeklyCommentary | null): { html: string; pdf: string } {
  const base = `AMC Weekly Update ${asOf}`;
  const html = join(dir, `${base}.html`);
  const pdf = join(dir, `${base}.pdf`);
  writeFileSync(html, renderWeeklyReportHtml(data, commentary));
  execFileSync(findChrome(), ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, pathToFileURL(html).href], { stdio: "ignore", timeout: 120_000 });
  if (!existsSync(pdf)) throw new Error("Chrome did not write the PDF");
  return { html, pdf };
}

/** A pass stamp that still matches the figures and text it was given, with a clean number check. */
function checkedProblem(data: WeeklyReportData, commentary: WeeklyCommentary | null): string | null {
  if (!commentary) return "no commentary";
  if (commentary.check?.verdict !== "pass") return "the commentary has not passed the number check";
  if (commentary.check.hash !== contentHash(data, commentary)) return "the figures or commentary changed after the check was stamped";
  const { summary } = verifyCommentary(data, commentary);
  if (summary.unmatched > 0 || summary.badRefs > 0) return `${summary.unmatched} unmatched numbers, ${summary.badRefs} bad refs`;
  return null;
}

export async function reportRender(dateArg?: string) {
  const { asOf, dir } = resolveFolder(dateArg);
  const data = readJson<WeeklyReportData>(join(dir, "figures.json"));
  if (!data) throw new Error(`no figures.json in ${dir}`);
  const commentary = readJson<WeeklyCommentary>(join(dir, "commentary.json"));
  const { html, pdf } = renderFiles(dir, asOf, data, commentary);
  const problem = checkedProblem(data, commentary);
  // Only a number-checked report goes to the reports folder; a draft stays in the work folder.
  let copied: string[] = [];
  if (!problem) {
    const out = join(OUT_DIR, asOf);
    mkdirSync(out, { recursive: true });
    copied = [html, pdf].map((f) => {
      const to = join(out, f.slice(dir.length + 1));
      copyFileSync(f, to);
      return to;
    });
  }
  console.log(JSON.stringify({ asOf, checked: !problem, ...(problem ? { notChecked: problem } : {}), html, pdf, copied }, null, 2));
}

export async function reportPublish(dateArg?: string) {
  const { asOf, dir } = resolveFolder(dateArg);
  const saved = readJson<WeeklyReportData>(join(dir, "figures.json"));
  const commentary = readJson<WeeklyCommentary>(join(dir, "commentary.json"));
  if (!saved || !commentary) throw new Error(`figures.json and commentary.json are both needed in ${dir}`);
  // Never trust the work folder alone (agents can write it): the figures must
  // match a fresh computation from production, the stamp must match the text,
  // and the HTML/PDF are rendered here rather than read from disk.
  const { data: fresh } = await computeFigures(asOf);
  if (figuresKey(fresh) !== figuresKey(saved)) throw new Error("figures.json no longer matches production; re-run the report");
  const problem = checkedProblem(saved, commentary);
  if (problem) throw new Error(`not publishing: ${problem}`);
  const { html, pdf } = renderFiles(dir, asOf, saved, commentary);
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("the admin secret is not set in .env.local");
  const res = await fetch(`${PROD_URL}/api/admin/weekly-reports`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": secret },
    body: JSON.stringify({
      weekEnding: saved.weekEnding,
      asOfDate: saved.asOf,
      html: readFileSync(html, "utf8"),
      pdfBase64: readFileSync(pdf).toString("base64"),
      figures: saved,
      commentary,
    }),
  });
  const body = await res.text();
  console.log(JSON.stringify({ asOf, httpStatus: res.status, response: body.slice(0, 300) }, null, 2));
  if (!res.ok) {
    if (res.status === 401) console.error("401: the local admin secret doesn't match production's; update it in .env.local.");
    process.exitCode = 1;
  }
}
