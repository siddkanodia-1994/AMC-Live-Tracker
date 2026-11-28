// The weekly report's file name, the same for the /admin PDF download, the
// API's attachment name, the page title (Print / Save as PDF suggests it) and
// the Saturday folder copy: "20261128_Weekly AMC update", dated the Saturday
// of the week whose data it carries (Friday 27 Nov 2026 → 20261128), like
// the broker report's "20261128_Weekly Brokers Update.pdf".

/** The Saturday on or after the report's as-of trading day, as YYYY-MM-DD. */
export function weeklyReportDate(asOf: string): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`bad as-of date: ${asOf}`);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

/** "20261128_Weekly AMC update" (no extension). */
export function weeklyReportFileBase(asOf: string): string {
  return `${weeklyReportDate(asOf).replaceAll("-", "")}_Weekly AMC update`;
}
