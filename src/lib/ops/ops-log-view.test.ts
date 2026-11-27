import { describe, expect, it } from "vitest";
import { latestRun, recentAgentRows, type OpsLogViewRow } from "./ops-log-view";

let nextId = 1;
const row = (runId: string, loop: string, node: string, status: string, createdAt: string, source = "cron"): OpsLogViewRow => ({ id: nextId++, runId, source, loop, node, status, createdAt });

// 26 Nov: the 16:05 run (two steps + run-complete), then the 18:05 retry that found it done.
const primary = [
  row("p", "daily-snapshot", "computeLiveAum", "warn", "2026-11-26T10:40:35Z"),
  row("p", "daily-snapshot", "runMcxIngestion", "warn", "2026-11-26T10:40:35Z"),
  row("p", "daily-snapshot", "run-complete", "warn", "2026-11-26T10:40:35Z"),
];
const retry = [row("r", "daily-snapshot", "run-complete", "skipped", "2026-11-26T12:48:34Z")];
const newestFirst = [...retry, ...primary.slice().reverse()];

describe("latestRun", () => {
  it("returns the newest run's rows in write order", () => {
    expect(latestRun(newestFirst, "daily-snapshot").map((r) => r.runId)).toEqual(["r"]);
  });

  it("passes over a skipped retry to the run that did the work", () => {
    const rows = latestRun(newestFirst, "daily-snapshot", { skipSkippedRuns: true });
    expect(rows.map((r) => r.node)).toEqual(["computeLiveAum", "runMcxIngestion", "run-complete"]);
  });

  it("shows a retry that actually ran (the 16:05 run had failed)", () => {
    const ranRetry = [row("r2", "daily-snapshot", "computeLiveAum", "ok", "2026-11-27T12:40:00Z"), row("r2", "daily-snapshot", "run-complete", "ok", "2026-11-27T12:40:00Z")];
    expect(latestRun([...ranRetry.reverse(), ...newestFirst], "daily-snapshot", { skipSkippedRuns: true })[0].runId).toBe("r2");
  });

  it("is empty when the loop has no runs", () => {
    expect(latestRun(newestFirst, "ops-probe")).toEqual([]);
  });
});

describe("recentAgentRows", () => {
  const now = new Date("2026-11-27T12:00:00Z");

  it("keeps non-ok agent rows from the last 7 days only", () => {
    const rows = [
      row("a", "data-ops", "repair:sync-instruments", "fixed", "2026-11-25T06:00:00Z", "agent"),
      row("b", "data-ops", "sense", "ok", "2026-11-25T06:00:00Z", "agent"),
      row("c", "ingest", "validate", "fail", "2026-11-23T04:17:35Z", "agent"), // 4 days old: kept
      row("d", "ingest", "validate", "fail", "2026-11-19T04:00:00Z", "agent"), // 8 days old: dropped
      row("e", "daily-snapshot", "computeLiveAum", "warn", "2026-11-26T10:40:35Z"), // not an agent row
    ];
    expect(recentAgentRows(rows, now).map((r) => r.runId)).toEqual(["a", "c"]);
  });

  it("drops the 23 Nov ingest fail once a week has passed", () => {
    const rows = [row("c", "ingest", "validate", "fail", "2026-11-23T04:17:35Z", "agent")];
    expect(recentAgentRows(rows, new Date("2026-11-30T05:00:00Z"))).toEqual([]);
  });
});
