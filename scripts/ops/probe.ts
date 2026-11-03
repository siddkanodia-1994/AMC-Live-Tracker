import { runProbe } from "../../src/lib/ops/probe";
import { flushOpsRun, startOpsRun } from "../../src/lib/ops/run-log";

// Deterministic pipeline health probe. Writes one ops_run_log row per check
// (source "probe", loop "ops-probe") unless --dry-run is passed, in which
// case it only prints. Exit code is always 0 on a completed probe, even with
// failing checks -- failures are data for the Agent Ops panel, not a broken
// job; a non-zero exit means the probe itself could not run.
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = await runProbe();
  for (const r of rows) {
    console.log(`${r.status.padEnd(7)} ${r.node.padEnd(26)} ${r.summary}`);
  }
  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }
  const run = startOpsRun("probe", "ops-probe");
  run.rows.push(...rows);
  const worst = rows.some((r) => r.status === "fail") ? "fail" : rows.some((r) => r.status === "warn") ? "warn" : "ok";
  run.rows.push({ node: "run-complete", status: worst, summary: `${rows.filter((r) => r.status === "fail").length} failing, ${rows.filter((r) => r.status === "warn").length} warning` });
  await flushOpsRun(run);
  console.log(`\nWrote ${run.rows.length} rows (run ${run.runId}).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Ops probe failed to run:", err);
    process.exit(1);
  });
