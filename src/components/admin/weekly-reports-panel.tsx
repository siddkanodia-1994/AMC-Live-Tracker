"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminFetch } from "@/lib/admin-client";

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

/**
 * The Saturday AMC Weekly Update, one row per week. The files are behind
 * the admin secret, so they're fetched with it (a plain link can't send the
 * header). The HTML is shown in a fully sandboxed iframe -- no scripts, no
 * same-origin access -- so nothing in a stored report can read this page's
 * admin secret.
 */
export function WeeklyReportsPanel({ secret }: { secret: string }) {
  const [rows, setRows] = useState<WeeklyReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: number; label: string; html: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/weekly-reports", secret);
      if (!res.ok) throw new Error("Failed to load the weekly reports");
      const data: { reports: WeeklyReportRow[] } = await res.json();
      setRows(data.reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the weekly reports");
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
    try {
      const res = await adminFetch(`/api/admin/weekly-reports/${row.id}`, secret);
      if (!res.ok) throw new Error("Failed to open the report");
      setViewing({ id: row.id, label: `AMC Update, data to ${weekLabel(row.asOfDate)}`, html: await res.text() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open the report");
    } finally {
      setBusy(null);
    }
  }

  async function download(row: WeeklyReportRow) {
    setBusy(`pdf-${row.id}`);
    try {
      const res = await adminFetch(`/api/admin/weekly-reports/${row.id}?format=pdf`, secret);
      if (!res.ok) throw new Error("Failed to download the PDF");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `AMC Weekly Update ${row.weekEnding}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download the PDF");
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
              <Button variant="ghost" size="sm" onClick={() => setViewing(null)}>
                Close
              </Button>
            </div>
            <iframe title={viewing.label} sandbox="" srcDoc={viewing.html} className="h-[80vh] w-full rounded-md border bg-white" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
