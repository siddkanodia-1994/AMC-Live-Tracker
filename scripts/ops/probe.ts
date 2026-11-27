import { recordProbeRun, runProbe } from "../../src/lib/ops/probe";

// Deterministic pipeline health probe. Writes one ops_run_log row per check
// (source "probe", loop "ops-probe") unless --dry-run is passed, in which
// case it only prints. Exit code is always 0 on a completed probe, even with
// failing checks -- failures are data for the Agent Ops panel, not a broken
// job; a non-zero exit means the probe itself could not run.
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = dryRun ? await runProbe() : await recordProbeRun(process.env.GITHUB_ACTIONS ? "GitHub Action" : "manual run");
  if (!dryRun && rows.length === 0) throw new Error("probe did not run (see the error above)");
  for (const r of rows) {
    console.log(`${r.status.padEnd(7)} ${r.node.padEnd(26)} ${r.summary}`);
  }
  console.log(dryRun ? "\n--dry-run: nothing written." : `\nRecorded ${rows.length} checks + run-complete.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Ops probe failed to run:", err);
    process.exit(1);
  });
