import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, ne } from "drizzle-orm";
import { db } from "../db/client";
import { opsRunLog } from "../db/schema";

// Thin helpers over ops_run_log (see schema.ts). Everything here is
// best-effort: the ledger is observability, never part of the job it
// observes, so a failed write is logged and swallowed rather than allowed to
// fail the cron step / probe / agent run that called it.

export type OpsSource = "cron" | "probe" | "agent";
export type OpsStatus = "ok" | "warn" | "fail" | "proposal" | "fixed" | "skipped";

export interface OpsRow {
  node: string;
  status: OpsStatus;
  summary: string;
  details?: Record<string, unknown>;
  durationMs?: number;
}

export interface OpsRun {
  runId: string;
  source: OpsSource;
  loop: string;
  rows: OpsRow[];
}

export function startOpsRun(source: OpsSource, loop: string): OpsRun {
  return { runId: randomUUID(), source, loop, rows: [] };
}

/** Writes every buffered row in one insert. Never throws. */
export async function flushOpsRun(run: OpsRun): Promise<void> {
  if (run.rows.length === 0) return;
  try {
    await db.insert(opsRunLog).values(
      run.rows.map((r) => ({
        runId: run.runId,
        source: run.source,
        loop: run.loop,
        node: r.node,
        status: r.status,
        summary: r.summary.slice(0, 2000),
        details: r.details ?? null,
        durationMs: r.durationMs ?? null,
      }))
    );
  } catch (err) {
    console.error("Failed to write ops_run_log rows (ignored):", err);
  }
}

function warningsOf(result: unknown): string[] {
  if (result && typeof result === "object" && "warnings" in result) {
    const w = (result as { warnings: unknown }).warnings;
    if (Array.isArray(w)) return w.filter((x): x is string => typeof x === "string");
  }
  return [];
}

/**
 * Runs one isolated, best-effort step: times it, records ok / warn (the
 * result carried non-empty `warnings`, which callers previously discarded) /
 * fail (it threw), and returns its result -- or undefined if it threw, in
 * which case the error is logged exactly as the inline try/catch blocks did.
 */
export async function runOpsStep<T>(
  run: OpsRun,
  node: string,
  fn: () => Promise<T>,
  describe?: (result: T) => { summary?: string; details?: Record<string, unknown> }
): Promise<T | undefined> {
  const started = Date.now();
  try {
    const result = await fn();
    const warnings = warningsOf(result);
    const described = describe?.(result) ?? {};
    run.rows.push({
      node,
      status: warnings.length > 0 ? "warn" : "ok",
      summary: described.summary ?? (warnings.length > 0 ? warnings.join(" | ") : "ok"),
      details: { ...(described.details ?? {}), ...(warnings.length > 0 ? { warnings } : {}) },
      durationMs: Date.now() - started,
    });
    return result;
  } catch (err) {
    console.error(`Cron step ${node} failed:`, err);
    run.rows.push({
      node,
      status: "fail",
      summary: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - started,
    });
    return undefined;
  }
}

/**
 * Whether a run of `loop` that reached its final "run-complete" row with
 * status ok/warn exists since `sinceIso` -- used by the retry-only 18:05
 * cron to decide whether the 16:05 run already succeeded.
 */
export async function hasCompletedRunSince(loop: string, sinceIso: string): Promise<boolean> {
  const rows = await db
    .select({ status: opsRunLog.status })
    .from(opsRunLog)
    // A skipped retry row says nothing about whether the run itself completed.
    .where(and(eq(opsRunLog.loop, loop), eq(opsRunLog.node, "run-complete"), ne(opsRunLog.status, "skipped"), gte(opsRunLog.createdAt, new Date(sinceIso))))
    .orderBy(desc(opsRunLog.createdAt))
    .limit(1);
  return rows.length > 0 && (rows[0].status === "ok" || rows[0].status === "warn");
}

/**
 * Closes the monthly-file loop on the Agent Ops panel: after a successful
 * import (script or /admin upload) writes an `ingest/validate` "fixed" row,
 * which supersedes any earlier validate result for the file (see
 * recentAgentRows). Never throws.
 */
export async function recordImportClosure(result: { reportPeriod: string; amcsImported: number; holdingsImported: number }, via: string): Promise<void> {
  const run = startOpsRun("agent", "ingest");
  run.rows.push({
    node: "validate",
    status: "fixed",
    summary: `Imported ${result.reportPeriod} via ${via}: ${result.amcsImported} AMCs, ${result.holdingsImported.toLocaleString("en-IN")} holdings (closes any earlier validate result)`,
    details: { reportPeriod: result.reportPeriod, amcsImported: result.amcsImported, holdingsImported: result.holdingsImported, via },
  });
  await flushOpsRun(run);
}
