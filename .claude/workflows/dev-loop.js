export const meta = {
  name: 'dev-loop',
  description: 'Plan → implement in a worktree → verify (tsc/lint/test/build) → adversarial review, looping until green; stops at your push gate',
  whenToUse: 'For one scoped code change to the AMC dashboard. Pass args: {"task": "<what to build or fix>", "base": "main"}',
  phases: [
    { title: 'Plan', detail: 'scoped plan with files and checks' },
    { title: 'Implement', detail: 'worktree branch, committed' },
    { title: 'Verify', detail: 'tsc, lint, tests, build' },
    { title: 'Review', detail: 'adversarial review of the diff' },
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

// Graph:  Plan ─► Implement ─► Verify ─fail─► Implement (≤ 3)
//                                 └pass─► Review ─request-changes─► Implement (≤ 2 review rounds)
//                                              └approve─► return branch (you decide on push)

const task = args && args.task
const base = (args && args.base) || 'main'
if (!task) throw new Error('pass args: {"task": "<what to build or fix>"}')

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    plan: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    schemaChange: { type: 'boolean' },
    verification: { type: 'string' },
  },
  required: ['plan', 'files', 'schemaChange', 'verification'],
}
const IMPL_SCHEMA = {
  type: 'object',
  properties: { worktreePath: { type: 'string' }, branch: { type: 'string' }, summary: { type: 'string' } },
  required: ['worktreePath', 'branch', 'summary'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: { pass: { type: 'boolean' }, failures: { type: 'string' }, outOfScopeFiles: { type: 'array', items: { type: 'string' } } },
  required: ['pass', 'failures'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'request-changes'] },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string' }, location: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'problem'] } },
  },
  required: ['verdict', 'findings'],
}

phase('Plan')
const plan = await agent(
  `Plan this change to the AMC Live AUM Tracker (repo root is the current directory, base branch ${base}):\n${task}\n\nRead the relevant code first. Keep scope tight. Name every file to touch, whether a DB schema change is needed (additive only; migrations are the user's step), and how to verify it without running the dev server or any data script (local dev shares the production DB).`,
  { label: 'plan', agentType: 'Plan', schema: PLAN_SCHEMA }
)

let impl = await role('implementer', 
  `Implement this plan in your worktree and commit to its branch:\n${JSON.stringify(plan, null, 2)}\n\nTask: ${task}`,
  { label: 'implement#1', phase: 'Implement', isolation: 'worktree', schema: IMPL_SCHEMA }
)

let verify = null
let review = null
let fixRounds = 0
let reviewRounds = 0
while (impl) {
  verify = await role('verifier', `Verify the branch ${impl.branch} in worktree ${impl.worktreePath} against base ${base}. Scope: ${JSON.stringify(plan.files)}.`, {
    label: `verify#${fixRounds + reviewRounds + 1}`, phase: 'Verify', schema: VERIFY_SCHEMA,
  })
  if (!verify?.pass) {
    if (++fixRounds > 3) break
    impl = await role('implementer', 
      `In worktree ${impl.worktreePath} (branch ${impl.branch}), fix these verification failures, staying within the plan's scope, then commit:\n${verify?.failures}\nOut-of-scope files to revert if any: ${JSON.stringify(verify?.outOfScopeFiles || [])}`,
      { label: `fix#${fixRounds}`, phase: 'Implement', schema: IMPL_SCHEMA }
    )
    continue
  }
  review = await role('reviewer', `Review branch ${impl.branch} in worktree ${impl.worktreePath} against ${base}. The intended change: ${task}`, {
    label: `review#${reviewRounds + 1}`, phase: 'Review', schema: REVIEW_SCHEMA,
  })
  if (review?.verdict === 'approve') break
  if (++reviewRounds > 2) break
  impl = await role('implementer', 
    `In worktree ${impl.worktreePath} (branch ${impl.branch}), address these review findings, then commit:\n${JSON.stringify(review?.findings, null, 2)}`,
    { label: `address-review#${reviewRounds}`, phase: 'Implement', schema: IMPL_SCHEMA }
  )
}

const ready = !!(verify?.pass && review?.verdict === 'approve')
log(ready ? `Ready: ${impl.branch} passed verification and review. Push is your call.` : `Not ready after ${fixRounds} fix and ${reviewRounds} review round(s).`)
return { ready, plan, branch: impl?.branch, worktreePath: impl?.worktreePath, verify, review }
