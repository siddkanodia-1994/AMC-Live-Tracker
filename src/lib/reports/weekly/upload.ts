// Validation for `POST /api/admin/weekly-reports` (agent-cli report publish).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Both together (PDF base64-encoded) stay under Vercel's ~4.5 MB request body limit.
export const MAX_HTML_BYTES = 1024 * 1024;
export const MAX_PDF_BYTES = 2 * 1024 * 1024;
// The report is static HTML: anything that could run script is refused.
const ACTIVE_CONTENT = /<script|<iframe|<object|<embed|\son[a-z]+\s*=|javascript:/i;

export interface WeeklyReportUpload {
  weekEnding: string;
  asOfDate: string;
  html: string;
  pdfBase64: string | null;
  figures: Record<string, unknown> | null;
  commentary: Record<string, unknown> | null;
}

function isDate(v: unknown): v is string {
  return typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseWeeklyReportUpload(body: unknown): { ok: true; value: WeeklyReportUpload } | { ok: false; error: string } {
  if (!isPlainObject(body)) return { ok: false, error: "body must be a JSON object" };
  const { weekEnding, asOfDate, html, pdfBase64, figures, commentary } = body;
  if (!isDate(weekEnding)) return { ok: false, error: "weekEnding must be YYYY-MM-DD" };
  if (!isDate(asOfDate)) return { ok: false, error: "asOfDate must be YYYY-MM-DD" };
  if (typeof html !== "string" || !html.trim().startsWith("<!doctype html>")) return { ok: false, error: "html must be the rendered report" };
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) return { ok: false, error: "html is over 1 MB" };
  if (ACTIVE_CONTENT.test(html)) return { ok: false, error: "html contains script or event handlers" };
  if (pdfBase64 !== undefined && pdfBase64 !== null) {
    if (typeof pdfBase64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64)) return { ok: false, error: "pdfBase64 must be base64" };
    const bytes = Buffer.from(pdfBase64, "base64");
    if (bytes.length > MAX_PDF_BYTES) return { ok: false, error: "pdf is over 2 MB" };
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return { ok: false, error: "pdfBase64 is not a PDF" };
  }
  if (figures !== undefined && figures !== null && !isPlainObject(figures)) return { ok: false, error: "figures must be an object" };
  if (commentary !== undefined && commentary !== null && !isPlainObject(commentary)) return { ok: false, error: "commentary must be an object" };
  return {
    ok: true,
    value: {
      weekEnding,
      asOfDate,
      html,
      pdfBase64: typeof pdfBase64 === "string" ? pdfBase64 : null,
      figures: isPlainObject(figures) ? figures : null,
      commentary: isPlainObject(commentary) ? commentary : null,
    },
  };
}
