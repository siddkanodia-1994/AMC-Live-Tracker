export const meta = {
  name: 'ingest',
  description: 'Validate a new monthly vendor workbook with a zero-write dry run, cross-check it adversarially, and stage a verdict for your approval (never imports)',
  whenToUse: 'When a new Mirae Asset MF Tracker file arrives (after the 15th). Pass args: {"file": "<absolute path to .xlsx>"}',
  phases: [
    { title: 'Validate', detail: 'dry-run parse + diff vs prior period' },
    { title: 'Challenge', detail: 'independent skeptic re-checks red flags' },
    { title: 'Gate', detail: 'proposal row for your approval' },
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

// Graph:  Validate ─► Challenge ─disagree─► Validate (≤ 2 rounds) ─► Gate(proposal)
// The real import stays the user's action (/admin upload or `npm run import`);
// the agent gate hook blocks it for agents.

const CLI = 'npm run -s ops:agent --'
const file = args && args.file
if (!file) throw new Error('pass args: {"file": "<absolute path to the .xlsx>"}')

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['ready-to-import', 'import-with-caveats', 'do-not-import'] },
    reportPeriod: { type: 'string' },
    keyNumbers: { type: 'string' },
    redFlags: { type: 'array', items: { type: 'string' } },
    manualChecks: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'keyNumbers', 'redFlags'],
}
const CHALLENGE_SCHEMA = {
  type: 'object',
  properties: {
    agrees: { type: 'boolean' },
    missedIssues: { type: 'array', items: { type: 'string' } },
    falseAlarms: { type: 'array', items: { type: 'string' } },
  },
  required: ['agrees', 'missedIssues', 'falseAlarms'],
}

let verdict = null
let challenge = null
for (let round = 1; round <= 2; round++) {
  phase('Validate')
  verdict = await role('ingest-validator', 
    `Validate the vendor workbook at ${JSON.stringify(file)} per your instructions.` +
      (challenge ? `\n\nAn independent reviewer challenged your previous verdict:\n${JSON.stringify(challenge, null, 2)}\nRe-check those points specifically.` : ''),
    { label: `validate#${round}`, schema: VERDICT_SCHEMA }
  )
  phase('Challenge')
  challenge = await role('ingest-validator', 
    `Act as a skeptical second reviewer of a monthly holdings import. Another agent produced this verdict for ${JSON.stringify(file)}:\n${JSON.stringify(verdict, null, 2)}\n` +
      `Independently re-run \`npm run -s import:dry-run -- ${JSON.stringify(file)}\` and spot-check with read-only SQL (\`${CLI} sql "..."\`). ` +
      `Look for issues it missed (truncated/duplicated sheets, wrong period, AMC name drift, implausible AUM moves) and red flags that are actually normal. Never import.`,
    { label: `challenge#${round}`, schema: CHALLENGE_SCHEMA }
  )
  if (challenge?.agrees && !(challenge.missedIssues || []).length) break
}

phase('Gate')
const status = verdict?.verdict === 'do-not-import' ? 'fail' : 'proposal'
await agent(
  `Run exactly: ${CLI} log ingest validate ${status} ${JSON.stringify(`Vendor file ${verdict?.reportPeriod || ''}: ${verdict?.verdict} — ${verdict?.keyNumbers}`.slice(0, 500))} '${JSON.stringify({ file, verdict, challenge }).replace(/'/g, "’")}'\nDo nothing else.`,
  { label: 'ledger', model: 'haiku', effort: 'low' }
)
return { file, verdict, challenge }
