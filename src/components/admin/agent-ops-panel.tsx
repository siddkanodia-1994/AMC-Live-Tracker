"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminFetch } from "@/lib/admin-client";

type OpsStatus = "ok" | "warn" | "fail" | "proposal" | "fixed" | "skipped";

interface OpsRunLogRow {
  id: number;
  runId: string;
  source: "cron" | "probe" | "agent";
  loop: string;
  node: string;
  status: OpsStatus;
  summary: string;
  details: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: string;
}

const STATUS_CLASS: Record<OpsStatus, string> = {
  ok: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  fixed: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  warn: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  proposal: "border-sky-500/40 text-sky-600 dark:text-sky-400",
  fail: "border-red-500/40 text-red-600 dark:text-red-400",
  skipped: "text-muted-foreground",
};

function StatusBadge({ status }: { status: OpsStatus }) {
  return (
    <Badge variant="outline" className={STATUS_CLASS[status]}>
      {status}
    </Badge>
  );
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** The rows of the most recent run of `loop`, in the order they were written. */
function latestRun(rows: OpsRunLogRow[], loop: string): OpsRunLogRow[] {
  const first = rows.find((r) => r.loop === loop);
  if (!first) return [];
  return rows.filter((r) => r.runId === first.runId).sort((a, b) => a.id - b.id);
}

function RunTable({ title, rows, emptyText }: { title: string; rows: OpsRunLogRow[]; emptyText: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {rows[0] && <span className="text-xs text-muted-foreground">{formatWhen(rows[0].createdAt)}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-foreground/10 align-top last:border-0">
                  <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">{r.node}</td>
                  <td className="py-1.5 pr-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="py-1.5 text-muted-foreground">{r.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Read-only view of ops_run_log: the latest daily-cron run (one row per
 * step, with the warnings that used to be discarded), the latest ops probe
 * (deterministic checks, GitHub Actions 17:00 IST), and recent agent-loop
 * outcomes -- repairs it made ("fixed") and changes it wants you to approve
 * ("proposal"). Alerts live here only; nothing is sent anywhere.
 */
export function AgentOpsPanel({ secret }: { secret: string }) {
  const [rows, setRows] = useState<OpsRunLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/api/admin/ops-log", secret);
      if (!res.ok) throw new Error("Failed to load the ops log");
      const data: { rows: OpsRunLogRow[] } = await res.json();
      setRows(data.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the ops log");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time fetch, same pattern as weekend-price-anomalies.tsx
    refresh();
  }, [refresh]);

  const probeRun = useMemo(() => latestRun(rows, "ops-probe"), [rows]);
  const cronRun = useMemo(() => latestRun(rows, "daily-snapshot"), [rows]);
  const agentRows = useMemo(() => rows.filter((r) => r.source === "agent" && r.status !== "ok").slice(0, 20), [rows]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Agent Ops</CardTitle>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <RunTable title="Health probe" rows={probeRun.filter((r) => r.node !== "run-complete")} emptyText="No probe run recorded yet (GitHub Action, 17:00 IST weekdays)." />
        <RunTable title="Daily cron steps" rows={cronRun} emptyText="No cron run recorded yet (16:05 IST weekdays)." />
        <RunTable title="Agent repairs & proposals" rows={agentRows} emptyText="Nothing awaiting you." />
      </CardContent>
    </Card>
  );
}
