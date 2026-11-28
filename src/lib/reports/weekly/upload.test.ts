import { describe, expect, it } from "vitest";
import { MAX_HTML_BYTES, parseWeeklyReportUpload } from "./upload";

const PDF = Buffer.from("%PDF-1.7\n...").toString("base64");
const GOOD = { weekEnding: "2026-11-27", asOfDate: "2026-11-27", html: "<!doctype html><html></html>", pdfBase64: PDF, figures: { version: 1 }, commentary: { takeaways: [] } };

describe("parseWeeklyReportUpload", () => {
  it("accepts a full upload", () => {
    const r = parseWeeklyReportUpload(GOOD);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pdfBase64).toBe(PDF);
  });

  it("accepts an upload without the PDF or JSON", () => {
    const r = parseWeeklyReportUpload({ weekEnding: "2026-11-27", asOfDate: "2026-11-27", html: GOOD.html });
    expect(r.ok && r.value.pdfBase64 === null && r.value.figures === null).toBe(true);
  });

  it.each([
    [{ ...GOOD, weekEnding: "27-11-2026" }, "weekEnding"],
    [{ ...GOOD, asOfDate: "2026-13-45" }, "asOfDate"],
    [{ ...GOOD, html: "hello" }, "html"],
    [{ ...GOOD, html: `<!doctype html>${"x".repeat(MAX_HTML_BYTES)}` }, "1 MB"],
    [{ ...GOOD, html: "<!doctype html><img src=x onerror=alert(1)>" }, "script"],
    [{ ...GOOD, html: "<!doctype html><script>1</script>" }, "script"],
    [{ ...GOOD, html: '<!doctype html><a href="javascript:x">' }, "script"],
    [{ ...GOOD, pdfBase64: "not base64!" }, "base64"],
    [{ ...GOOD, pdfBase64: Buffer.from("hello").toString("base64") }, "not a PDF"],
    [{ ...GOOD, figures: [1, 2] }, "figures"],
    [null, "JSON object"],
  ])("rejects bad input (%#)", (body, msg) => {
    const r = parseWeeklyReportUpload(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(msg);
  });
});
