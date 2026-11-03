export const meta = {
  name: 'data-ops',
  description: 'AMC dashboard data-ops loop: probe → triage → diagnose → allowlisted repair → re-probe (≤3 attempts) → ledger',
  whenToUse: 'Daily after the 17:00 IST probe, or whenever the dashboard looks wrong. Read-only except allowlisted idempotent repairs.',
  phases: [
    { title: 'Sense', detail: 'run the deterministic probe' },
    { title: 'Triage', detail: 'route each non-ok check' },
    { title: 'Diagnose', detail: 'read-only root cause per issue' },
    { title: 'Repair', detail: 'allowlisted repairs, one at a time, re-probed' },
    { title: 'Ledger', detail: 'write outcomes to ops_run_log' },
  ],
}

// Runs `name` from .claude/agents/ when the session has it registered (any
// session started after those files existed); otherwise falls back to a
// general-purpose agent told to adopt that role file, on the same model
// tier. The agent gate hook applies identically either way.
const ROLE_MODELS = { 'ops-orchestrator': 'opus', reviewer: 'opus', 'ops-diagnoser': 'sonnet', 'ingest-validator': 'sonnet', 'analyst-writer': 'sonnet', implementer: 'sonnet', verifier: 'sonnet', 'number-checker': 'haiku' }
async function role(name, prompt, opts = {}) {
  try {
    return await agent(prompt, { ...opts, agentType: name })
  } catch (err) {
    if (!/not found/i.test(String(err && err.message))) throw err
    return agent(
      `Before anything else, read .claude/agents/${name}.md and follow it as your role and rules for this task.\n\n${prompt}`,
      { ...opts, agentType: 'general-purpose', model: opts.model || ROLE_MODELS[name] }
    )
  }
}

// Graph:  Sense ──all ok──► Ledger(ok)
//           └─issues─► Triage ─► {repair | diagnose | user-action | known-ok}
//                         diagnose ─► Diagnose ─► repair? ─► Repair ⟲ (≤ MAX_ATTEMPTS, re-probe each time)
//                                                    └─ otherwise ─► proposal
//         every terminal node ─► Ledger
// Hard gates (push, migrations, deletes, non-allowlisted writes) are enforced
// by .claude/hooks/agent-gate.py, not by these prompts.

const MAX_ATTEMPTS = 3
const ALLOWED_REPAIRS = ['reclaim-outages', 'reclaim-forward-gap', 'sync-instruments', 'refresh-foreign-prices', 'sync-foreign-instruments']
const CLI = 'npm run -s ops:agent --'

const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    rows: { type: 'array', items: { type: 'object', properties: { node: { type: 'string' }, status: { type: 'string' }, summary: { type: 'string' } }, required: ['node', 'status', 'summary'] } },
  },
  required: ['rows'],
}
const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    routes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          node: { type: 'string' },
          route: { type: 'string', description: 'repair:<action> | diagnose | user-action | known-ok' },
          reason: { type: 'string' },
        },
        required: ['node', 'route', 'reason'],
      },
    },
  },
  required: ['routes'],
}
const DIAG_SCHEMA = {
  type: 'object',
  properties: {
    rootCause: { type: 'string' },
    evidence: { type: 'string' },
    action: { type: 'string', description: 'repair:<action> | proposal:<text> | user-action:<text> | none' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['rootCause', 'evidence', 'action', 'confidence'],
}
const REPAIR_SCHEMA = {
  type: 'object',
  properties: {
    repairOk: { type: 'boolean' },
    recheckStatus: { type: 'string', description: "the re-probed status of the target check: ok|warn|fail|skipped" },
    recheckSummary: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['repairOk', 'recheckStatus', 'recheckSummary'],
}

const repairActionOf = (route) => {
  const m = /^repair:([a-z-]+)$/.exec((route || '').trim())
  return m && ALLOWED_REPAIRS.includes(m[1]) ? m[1] : null
}

// ── Sense ──────────────────────────────────────────────────────────────
phase('Sense')
const probe = await agent(
  `Run \`${CLI} probe\` in the repo root and return every row it prints (node, status, summary) verbatim. Do nothing else.`,
  { label: 'probe', model: 'haiku', effort: 'low', schema: PROBE_SCHEMA }
)
const issues = (probe?.rows || []).filter((r) => r.status === 'fail' || r.status === 'warn')
const outcomes = []

if (issues.length === 0) {
  log('All probe checks ok — nothing to do.')
  outcomes.push({ node: 'sense', status: 'ok', summary: `all ${probe?.rows?.length ?? 0} probe checks ok/skipped` })
} else {
  log(`${issues.length} check(s) need attention: ${issues.map((i) => i.node).join(', ')}`)

  // ── Triage ─────────────────────────────────────────────────────────
  phase('Triage')
  const triage = await role('ops-orchestrator', 
    `These deterministic probe checks are not ok:\n${JSON.stringify(issues, null, 2)}\n\nThe full probe output (for context):\n${JSON.stringify(probe.rows, null, 2)}\n\nRoute every non-ok check per your routing rules. Allowed repair actions: ${ALLOWED_REPAIRS.join(', ')}.`,
    { label: 'triage', schema: TRIAGE_SCHEMA }
  )
  const routes = triage?.routes || []

  // ── Diagnose (parallel, read-only) ─────────────────────────────────
  phase('Diagnose')
  const toDiagnose = routes.filter((r) => r.route === 'diagnose')
  const diagnoses = await parallel(
    toDiagnose.map((r) => () =>
      role('ops-diagnoser', 
        `Investigate this probe issue (read-only) and recommend exactly one action.\nCheck: ${r.node}\nProbe row: ${JSON.stringify(issues.find((i) => i.node === r.node))}\nTriage note: ${r.reason}\nAllowed repairs: ${ALLOWED_REPAIRS.join(', ')}. Do NOT run any repair yourself in this step.`,
        { label: `diagnose:${r.node}`, phase: 'Diagnose', schema: DIAG_SCHEMA }
      ).then((d) => ({ node: r.node, diagnosis: d }))
    )
  )

  // Build the repair queue: direct triage repairs + diagnoses that recommend one.
  const repairQueue = []
  for (const r of routes) {
    const action = repairActionOf(r.route)
    if (action) repairQueue.push({ node: r.node, action, why: r.reason })
    else if (r.route === 'user-action') outcomes.push({ node: r.node, status: 'proposal', summary: `Needs you: ${r.reason}` })
    else if (r.route === 'known-ok') outcomes.push({ node: r.node, status: 'skipped', summary: `Expected: ${r.reason}` })
    else if (r.route !== 'diagnose') outcomes.push({ node: r.node, status: 'proposal', summary: `Unrouted (${r.route}): ${r.reason}` })
  }
  for (const d of diagnoses.filter(Boolean)) {
    const action = repairActionOf(d.diagnosis?.action)
    if (action) repairQueue.push({ node: d.node, action, why: d.diagnosis.rootCause })
    else
      outcomes.push({
        node: d.node,
        status: 'proposal',
        summary: `${d.diagnosis?.action || 'no action'} — ${d.diagnosis?.rootCause || 'diagnosis failed'}`,
        details: d.diagnosis || null,
      })
  }

  // ── Repair (sequential: DHAN allows ~1 req/s across the whole app) ──
  phase('Repair')
  for (const item of repairQueue) {
    let attempt = 0
    let action = item.action
    let last = null
    while (attempt < MAX_ATTEMPTS) {
      attempt++
      last = await role('ops-diagnoser', 
        `The workflow authorises exactly one repair: run \`${CLI} repair ${action}\` once. Then run \`${CLI} probe\` and report the re-probed status of the "${item.node}" check. Context: ${item.why}`,
        { label: `repair:${action}#${attempt}`, phase: 'Repair', schema: REPAIR_SCHEMA }
      )
      if (last && last.repairOk && (last.recheckStatus === 'ok' || last.recheckStatus === 'skipped')) break
      if (attempt >= MAX_ATTEMPTS) break
      // Not fixed yet: re-diagnose with what the repair returned before trying again.
      const again = await role('ops-diagnoser', 
        `A repair (${action}) for check "${item.node}" did not resolve it. Result: ${JSON.stringify(last)}. Investigate read-only and recommend the next action (another allowlisted repair, or a proposal). Allowed: ${ALLOWED_REPAIRS.join(', ')}. Do NOT run a repair yourself.`,
        { label: `rediagnose:${item.node}#${attempt}`, phase: 'Repair', schema: DIAG_SCHEMA }
      )
      const next = repairActionOf(again?.action)
      if (!next) {
        last = { ...last, notes: `stopped: ${again?.action || 'no further repair'} — ${again?.rootCause || ''}` }
        break
      }
      action = next
    }
    const fixed = last && last.repairOk && (last.recheckStatus === 'ok' || last.recheckStatus === 'skipped')
    outcomes.push({
      node: item.node,
      status: fixed ? 'fixed' : 'proposal',
      summary: fixed
        ? `Repaired via ${action} (attempt ${attempt}): ${last.recheckSummary}`
        : `Still ${last?.recheckStatus || 'unknown'} after ${attempt} attempt(s) of allowlisted repairs — ${last?.notes || last?.recheckSummary || 'needs you'}`,
      details: last || null,
    })
  }
}

// ── Ledger ─────────────────────────────────────────────────────────────
phase('Ledger')
await agent(
  `Write these outcomes to the ledger, one command per outcome, exactly in this form (shell-quote safely; details as compact JSON or omit):\n` +
    `${CLI} log data-ops <node> <status> "<summary>" '<detailsJson>'\n\nOutcomes:\n${JSON.stringify(outcomes, null, 2)}\n\nDo nothing else.`,
  { label: 'ledger', model: 'haiku', effort: 'low' }
)
return { checks: probe?.rows?.length ?? 0, issues: issues.length, outcomes }
