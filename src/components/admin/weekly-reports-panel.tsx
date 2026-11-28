"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { adminFetch } from "@/lib/admin-client";
import { weeklyReportFileBase } from "@/lib/reports/weekly/file-name";

interface WeeklyReportRow {
  id: number;
  weekEnding: string;
  asOfDate: string;
  createdAt: string;
  updatedAt: string;
  htmlBytes: number;
  pdfBytes: number | null;
  checkVerdict: string | null;
}

function kb(bytes: number | null): string {
  return bytes == null || !Number.isFinite(bytes) ? "–" : `${Math.round(bytes / 1024)} KB`;
}

function weekLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Time limits, so a stalled connection can't leave a button on "Downloading…"
// for good. The server sends a report file in about a second; the live route
// may take up to its 60 s maxDuration. The signal also covers reading the body.
const FILE_TIMEOUT_MS = 30_000;
const GENERATE_TIMEOUT_MS = 70_000;

function errorMessage(err: unknown, what: string, ms: number, fallback: string): string {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") return `${what} didn't arrive within ${ms / 1000} s (the connection stalled). Try again.`;
  return err instanceof Error ? err.message : fallback;
}

/**
 * The Saturday AMC Weekly Update, one row per week. The files are behind
 * the admin secret, so they're fetched with it (a plain link can't send the
 * header). The HTML is shown in a sandboxed iframe that may not run any
 * script (no allow-scripts), so nothing in a report can read this page's
 * admin secret; same-origin is allowed only so this page can print it.
 * "Generate report now" builds the figures-only report from live data.
 */
export function WeeklyReportsPanel({ secret }: { secret: string }) {
  const [rows, setRows] = useState<WeeklyReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: number; label: string; html: string } | null>(null);
  const [asOf, setAsOf] = useState("");
  const frameRef = useRef<HTMLIFrameElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/weekly-reports", secret, { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) });
      if (!res.ok) throw new Error("Failed to load the weekly reports");
      const data: { reports: WeeklyReportRow[] } = await res.json();
      setRows(data.reports);
    } catch (err) {
      setError(errorMessage(err, "The list", FILE_TIMEOUT_MS, "Failed to load the weekly reports"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch, same pattern as agent-ops-panel.tsx
    refresh();
  }, [refresh]);

  async function open(row: WeeklyReportRow) {
    setBusy(`html-${row.id}`);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/weekly-reports/${row.id}`, secret, { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) });
      if (!res.ok) throw new Error("Failed to open the report");
      setViewing({ id: row.id, label: `AMC Update, data to ${weekLabel(row.asOfDate)}`, html: await res.text() });
    } catch (err) {
      setError(errorMessage(err, "The report", FILE_TIMEOUT_MS, "Failed to open the report"));
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    setBusy("live");
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/weekly-reports/live${asOf ? `?asOf=${asOf}` : ""}`, secret, { signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed to generate the report");
      setViewing({ id: -1, label: `Live figures${asOf ? ` to ${weekLabel(asOf)}` : ", latest trading day"} (no commentary)`, html: await res.text() });
    } catch (err) {
      setError(errorMessage(err, "The live report", GENERATE_TIMEOUT_MS, "Failed to generate the report"));
    } finally {
      setBusy(null);
    }
  }

  async function download(row: WeeklyReportRow) {
    setBusy(`pdf-${row.id}`);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/weekly-reports/${row.id}?format=pdf`, secret, { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) });
      if (!res.ok) throw new Error("Failed to download the PDF");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${weeklyReportFileBase(row.weekEnding)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(errorMessage(err, "The PDF", FILE_TIMEOUT_MS, "Failed to download the PDF"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Weekly reports</CardTitle>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2">
          <span className="text-sm font-medium">Generate report now</span>
          <Input type="date" value={asOf} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setAsOf(e.target.value)} className="h-8 w-40" aria-label="Report date (blank = latest)" />
          <Button size="sm" disabled={busy !== null} onClick={generate}>
            {busy === "live" ? "Generating…" : "Generate"}
          </Button>
          <span className="text-xs text-muted-foreground">Live figures, tables and charts (blank date = latest); the commentary comes with the Saturday run.</span>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {!loading && rows.length === 0 && !error && <p className="text-sm text-muted-foreground">No weekly report yet (runs Saturdays 09:00 IST).</p>}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-foreground/10 last:border-0">
                    <td className="py-1.5 pr-3 whitespace-nowrap">AMC Update, data to {weekLabel(r.asOfDate)}</td>
                    <td className="py-1.5 pr-3">
                      {r.checkVerdict === "pass" ? (
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                          checked
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
                          unchecked
                        </Badge>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                      {kb(r.htmlBytes)} · PDF {kb(r.pdfBytes)}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => open(r)}>
                        {busy === `html-${r.id}` ? "Opening…" : viewing?.id === r.id ? "Shown below" : "Open"}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={busy !== null || r.pdfBytes == null} onClick={() => download(r)}>
                        {busy === `pdf-${r.id}` ? "Downloading…" : "PDF"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {viewing && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{viewing.label}</p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" onClick={() => frameRef.current?.contentWindow?.print()}>
                  Print / Save as PDF
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setViewing(null)}>
                  Close
                </Button>
              </div>
            </div>
            <iframe ref={frameRef} title={viewing.label} sandbox="allow-same-origin allow-modals" srcDoc={viewing.html} className="h-[80vh] w-full rounded-md border bg-white" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
