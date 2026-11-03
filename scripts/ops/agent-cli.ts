import { neon } from "@neondatabase/serverless";
import { refreshForeignPrices, syncForeignInstrumentMap } from "../../src/lib/aum/foreign-pricing";
import { runProbe } from "../../src/lib/ops/probe";
import { flushOpsRun, startOpsRun, type OpsStatus } from "../../src/lib/ops/run-log";

// The ONLY way the Claude Code agent loops (.claude/workflows/*) touch data.
// Hooks in .claude/settings.json block agents from running any other script
// against the database, so everything an agent can do is enumerated here:
//
//   sql "<single SELECT/WITH query>"   read-only (Postgres READ ONLY txn, 15s timeout, ≤500 rows)
//   probe                              run the deterministic probe, print rows (no write)
//   repair <action>                    one allowlisted, idempotent repair via the production admin API
//   log <loop> <node> <status> <summary> [detailsJson]   append an agent row to ops_run_log
//
// Local dev shares the production database, so "read-only" is enforced by
// the database itself (READ ONLY transaction), not by inspecting the text.

const PROD_URL = process.env.OPS_APP_URL ?? "https://amc-live-aum-tracker.vercel.app";

// Allowlisted repairs: each is an existing, idempotent admin endpoint the
// user already runs by hand from /admin. Nothing else is reachable.
const REPAIRS: Record<string, { path: string; what: string }> = {
  "reclaim-outages": { path: "/api/admin/reclaim-outages", what: "re-fetch DHAN historical closes for detected outage days" },
  "reclaim-forward-gap": { path: "/api/admin/reclaim-forward-gap", what: "backfill days since the current period began" },
  "sync-instruments": { path: "/api/admin/sync-instruments", what: "re-sync the DHAN instrument master (ISIN → security ID)" },
};

// Local repairs: the same idempotent upserts the GitHub Action /
// `npm run sync-foreign-instruments` already perform (Finnhub, ~3 min).
const LOCAL_REPAIRS: Record<string, { run: () => Promise<unknown>; what: string }> = {
  "refresh-foreign-prices": { run: () => refreshForeignPrices(), what: "refresh cached US quotes + USD/INR" },
  "sync-foreign-instruments": { run: () => syncForeignInstrumentMap(), what: "re-map US ISINs to Finnhub symbols" },
};

const STATUSES: OpsStatus[] = ["ok", "warn", "fail", "proposal", "fixed", "skipped"];

function usage(): never {
  console.error(
    [
      "usage:",
      '  agent-cli sql "<SELECT ...>"',
      "  agent-cli probe",
      `  agent-cli repair <${[...Object.keys(REPAIRS), ...Object.keys(LOCAL_REPAIRS)].join("|")}>`,
      "  agent-cli log <loop> <node> <ok|warn|fail|proposal|fixed|skipped> <summary> [detailsJson]",
    ].join("\n")
  );
  process.exit(2);
}

async function readOnlySql(query: string) {
  const q = query.trim().replace(/;+\s*$/, "");
  if (!/^(select|with)\b/i.test(q) || q.includes(";")) {
    throw new Error("only a single SELECT/WITH statement is allowed");
  }
  const sql = neon(process.env.DATABASE_URL!);
  // Wrapping caps the rows returned (Neon egress) and rejects anything that
  // isn't a single query expression; READ ONLY makes any write fail in Postgres.
  const [, rows] = await sql.transaction(
    [sql.query("set local statement_timeout = '15s'"), sql.query(`select * from (${q}) as agent_q limit 500`)],
    { readOnly: true }
  );
  console.log(JSON.stringify(rows, null, 2));
  console.error(`(${(rows as unknown[]).length} rows${(rows as unknown[]).length === 500 ? ", capped at 500" : ""})`);
}

async function repair(action: string) {
  const local = LOCAL_REPAIRS[action];
  if (local) {
    const started = Date.now();
    const run = startOpsRun("agent", "data-ops");
    try {
      const result = await local.run();
      run.rows.push({ node: `repair:${action}`, status: "fixed", summary: `${local.what}: done`, details: { result: result as Record<string, unknown> }, durationMs: Date.now() - started });
      console.log(JSON.stringify({ action, result }, null, 2));
    } catch (err) {
      run.rows.push({ node: `repair:${action}`, status: "fail", summary: `${local.what}: ${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - started });
      process.exitCode = 1;
    }
    await flushOpsRun(run);
    return;
  }
  const r = REPAIRS[action];
  if (!r) throw new Error(`"${action}" is not an allowlisted repair (${[...Object.keys(REPAIRS), ...Object.keys(LOCAL_REPAIRS)].join(", ")})`);
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET is not set");
  const started = Date.now();
  const res = await fetch(`${PROD_URL}${r.path}`, { method: "POST", headers: { "x-admin-secret": secret } });
  const body = await res.text();
  const run = startOpsRun("agent", "data-ops");
  run.rows.push({
    node: `repair:${action}`,
    status: res.ok ? "fixed" : "fail",
    summary: res.ok ? `${r.what}: done` : `${r.what}: HTTP ${res.status}`,
    details: { httpStatus: res.status, response: body.slice(0, 4000) },
    durationMs: Date.now() - started,
  });
  await flushOpsRun(run);
  console.log(JSON.stringify({ action, httpStatus: res.status, response: body.slice(0, 4000) }, null, 2));
  if (!res.ok) process.exitCode = 1;
}

async function log(loop: string, node: string, status: string, summary: string, detailsJson?: string) {
  if (!STATUSES.includes(status as OpsStatus)) throw new Error(`status must be one of ${STATUSES.join(", ")}`);
  const run = startOpsRun("agent", loop);
  run.rows.push({ node, status: status as OpsStatus, summary, details: detailsJson ? JSON.parse(detailsJson) : undefined });
  await flushOpsRun(run);
  console.log(`logged ${status} ${loop}/${node}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "sql":
      if (!rest[0]) usage();
      return readOnlySql(rest.join(" "));
    case "probe": {
      const rows = await runProbe();
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    case "repair":
      if (!rest[0]) usage();
      return repair(rest[0]);
    case "log":
      if (rest.length < 4) usage();
      return log(rest[0], rest[1], rest[2], rest[3], rest[4]);
    default:
      usage();
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
