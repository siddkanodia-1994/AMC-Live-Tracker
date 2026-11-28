export const meta = {
  name: 'weekly-report',
  description: 'Saturday AMC Weekly Update: figures from the AMC Analytics tab, Claude-written commentary, number check, HTML/PDF render, publish to /admin',
  whenToUse: 'Saturdays 09:00 IST (scheduled task amc-weekly-report), or by hand. Optional args: {"asOf": "YYYY-MM-DD", "publish": false}',
  phases: [
    { title: 'Figures', detail: 'GET the AMC Analytics payloads, compute figures.json' },
    { title: 'Write', detail: 'commentary from figures.json only', model: 'opus' },
    { title: 'Check', detail: 'mechanical verify + adversarial checker, ≤ 2 fixes' },
    { title: 'Render', detail: 'stamp, HTML + PDF, publish, ledger row' },
  ],
}

// Graph:  Figures ─► Write ─► Check ─fail─► Write (fix only failing bullets, ≤ 2) ─► Render/Publish ─► ledger
// Tables are code-generated; agents write and check only the bullets.
// Models / effort (user's standing rule: high or xhigh, model fit for the job):
// writer Opus xhigh, checker Sonnet high, command runner Sonnet high.

const ROLE_MODELS = { 'weekly-report-writer': 'opus', 'weekly-report-checker': 'sonnet' }
const ROLE_EFFORT = { 'weekly-report-writer': 'xhigh', 'weekly-report-checker': 'high' }
async function role(name, prompt, opts = {}) {
  const tuned = { ...opts, effort: ROLE_EFFORT[name] }
  try {
    return await agent(prompt, { ...tuned, agentType: name })
  } catch (err) {
    if (!/not found/i.test(String(err && err.message))) throw err
    return agent(`Before anything else, read .claude/agents/${name}.md and follow it as your role and rules for this task.\n\n${prompt}`, {
      ...tuned,
      agentType: 'general-purpose',
      model: ROLE_MODELS[name],
    })
  }
}

const CLI = 'npm run -s ops:agent --'
const RUNNER = { model: 'sonnet', effort: 'high' }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
if (args && args.asOf && !DATE_RE.test(args.asOf)) throw new Error('args.asOf must be YYYY-MM-DD')
const asOfArg = args && args.asOf ? ` ${args.asOf}` : ''
const publish = !(args && args.publish === false)

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: { type: 'object', properties: { command: { type: 'string' }, exitCode: { type: 'number' }, output: { type: 'string' } }, required: ['command', 'exitCode', 'output'] },
    },
  },
  required: ['steps'],
}
const FIG_SCHEMA = {
  type: 'object',
  properties: { exitCode: { type: 'number' }, asOf: { type: 'string' }, folder: { type: 'string' }, warnings: { type: 'array', items: { type: 'string' } }, problems: { type: 'array', items: { type: 'string' } } },
  required: ['exitCode', 'asOf', 'problems'],
}
const WRITE_SCHEMA = {
  type: 'object',
  properties: { commentaryPath: { type: 'string' }, verifyUnmatched: { type: 'number' }, verifyBadRefs: { type: 'number' } },
  required: ['commentaryPath', 'verifyUnmatched', 'verifyBadRefs'],
}
const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'object', properties: { where: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['where', 'problem'] } },
  },
  required: ['pass', 'failures'],
}

function runCommands(label, commands) {
  return agent(
    `Run these commands from the repo root, in order, exactly as written, and nothing else. Stop at the first one that exits non-zero.\n${commands.map((c, i) => `${i + 1}. ${c}`).join('\n')}\nReturn every command you ran with its exit code and its printed output (trimmed to 2000 characters).`,
    { label, schema: STEP_SCHEMA, ...RUNNER }
  )
}

async function ledger(status, summary) {
  // Shell-safe, and nothing the agent gate refuses to see in a command (secret names, admin paths).
  const text = summary
    .replace(/["`$\\]/g, "'")
    .replace(/ADMIN_SECRET|DATABASE_URL|DHAN_[A-Z_]*|\/api\/admin\/\S*/g, '[redacted]')
    .slice(0, 300)
  await runCommands('ledger', [`${CLI} log weekly-report report ${status} "${text}"`])
}

// ── Figures ──
phase('Figures')
const figs = await agent(
  `Run exactly this command from the repo root and nothing else:\n${CLI} report figures${asOfArg}\nReturn its exit code and the fields of the JSON it printed (asOf, folder, warnings, problems).`,
  { label: 'figures', schema: FIG_SCHEMA, ...RUNNER }
)
if (!figs || figs.exitCode !== 0 || (figs.problems && figs.problems.length)) {
  const why = figs ? (figs.problems || []).join('; ') || `exit ${figs.exitCode}` : 'figures step produced no output'
  await ledger('fail', `Weekly report: figures failed (${why})`)
  return { ok: false, stage: 'figures', why }
}
const asOf = figs.asOf
if (!DATE_RE.test(asOf)) {
  await ledger('fail', 'Weekly report: figures step returned no valid as-of date')
  return { ok: false, stage: 'figures', why: 'bad asOf' }
}
log(`Figures ready for ${asOf}${figs.warnings && figs.warnings.length ? ` (${figs.warnings.length} warnings)` : ''}`)

// ── Write ──
phase('Write')
const written = await role(
  'weekly-report-writer',
  `Write the AMC Weekly Update commentary for as-of ${asOf}, per your instructions. Figures: .claude/weekly-reports/${asOf}/figures.json. Write .claude/weekly-reports/${asOf}/commentary.json. Warnings from the figures step: ${JSON.stringify(figs.warnings || [])}`,
  { label: 'write', phase: 'Write', schema: WRITE_SCHEMA }
)
if (!written) {
  await ledger('fail', `Weekly report ${asOf}: the writer produced no commentary`)
  return { ok: false, stage: 'write' }
}

// ── Check (≤ 2 fix rounds) ──
phase('Check')
let check = null
for (let i = 0; i <= 2; i++) {
  check = await role('weekly-report-checker', `Check the AMC Weekly Update commentary for as-of ${asOf}, per your instructions.`, {
    label: `check#${i + 1}`,
    phase: 'Check',
    schema: CHECK_SCHEMA,
  })
  if (!check || check.pass || i === 2) break
  log(`Check ${i + 1}: ${check.failures.length} failure(s); sending them back to the writer`)
  await role(
    'weekly-report-writer',
    `Fix mode for as-of ${asOf}. The checker found these problems in .claude/weekly-reports/${asOf}/commentary.json:\n${JSON.stringify(check.failures, null, 2)}\nChange ONLY those bullets, keep everything else, then re-run report verify until it is clean.`,
    { label: `fix#${i + 1}`, phase: 'Write', schema: WRITE_SCHEMA }
  )
}
const passed = Boolean(check && check.pass)

// ── Render, publish, ledger ──
phase('Render')
const commands = [`${CLI} report stamp ${asOf} ${passed ? 'pass' : 'fail'} "${passed ? 'checker passed' : `${(check && check.failures.length) || 'unknown'} checker failures left`}"`, `${CLI} report render ${asOf}`]
if (passed && publish) commands.push(`${CLI} report publish ${asOf}`)
const run = await runCommands('render', commands)
const steps = (run && run.steps) || []
const failed = steps.find((s) => s.exitCode !== 0)
const rendered = steps.some((s) => s.command.includes('report render') && s.exitCode === 0)
const published = steps.some((s) => s.command.includes('report publish') && s.exitCode === 0)

let status
let summary
if (!passed) {
  status = 'fail'
  summary = `Weekly report ${asOf}: commentary failed the number check after 3 rounds; unchecked draft in .claude/weekly-reports/${asOf}/`
} else if (failed) {
  status = 'fail'
  const step = failed.command.replace(CLI, '').trim().split(' ').slice(0, 2).join(' ')
  summary = `Weekly report ${asOf}: ${step} failed (exit ${failed.exitCode})${/401/.test(failed.output) ? ': admin secret rejected, refresh it in .env.local' : ''}`
} else if (published) {
  status = 'ok'
  summary = `Weekly report ${asOf} published to /admin and saved to the AMC Weekly Reports folder`
} else {
  status = 'ok'
  summary = `Weekly report ${asOf} rendered and saved (not published: dry run)`
}
await ledger(status, summary)
return { ok: status === 'ok', asOf, passed, rendered, published, failures: (check && check.failures) || [], summary }
