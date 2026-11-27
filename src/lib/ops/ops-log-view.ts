// Pure selection helpers for the /admin Agent Ops panel (agent-ops-panel.tsx),
// kept here so they're unit-testable. `rows` is ops_run_log newest first, as
// GET /api/admin/ops-log returns it.

export interface OpsLogViewRow {
  id: number;
  runId: string;
  source: string;
  loop: string;
  node: string;
  status: string;
  createdAt: string;
}

/** How long a non-ok agent outcome stays on the panel. */
export const AGENT_ROW_MAX_AGE_DAYS = 7;

/**
 * The rows of the most recent run of `loop`, in the order they were written.
 * With `skipSkippedRuns`, a run whose run-complete row is "skipped" (the
 * 18:05 IST daily-snapshot retry when the 16:05 run already completed) is
 * passed over, so the panel shows the run that actually did the work.
 */
export function latestRun<R extends OpsLogViewRow>(rows: R[], loop: string, { skipSkippedRuns = false } = {}): R[] {
  const skipped = new Set(
    skipSkippedRuns ? rows.filter((r) => r.loop === loop && r.node === "run-complete" && r.status === "skipped").map((r) => r.runId) : [],
  );
  const first = rows.find((r) => r.loop === loop && !skipped.has(r.runId));
  if (!first) return [];
  return rows.filter((r) => r.runId === first.runId).sort((a, b) => a.id - b.id);
}

/** Agent outcomes that need a look (not "ok") from the last 7 days, newest first, at most 20. */
export function recentAgentRows<R extends OpsLogViewRow>(rows: R[], now: Date = new Date()): R[] {
  const cutoff = now.getTime() - AGENT_ROW_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return rows.filter((r) => r.source === "agent" && r.status !== "ok" && Date.parse(r.createdAt) >= cutoff).slice(0, 20);
}
