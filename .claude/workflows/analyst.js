export const meta = {
  name: 'analyst',
  description: 'Draft Fortnightly AMC Update summaries for the listed AMCs from production data, number-check every figure, and stage drafts for your review',
  whenToUse: 'When a fortnightly update is due. Optional args: {"amcs": ["hdfc-mutual-fund", ...]} (default: all 8 listed AMCs)',
  phases: [
    { title: 'Draft', detail: 'one writer per AMC' },
    { title: 'Check', detail: 'every number re-fetched and compared' },
    { title: 'Gate', detail: 'proposal rows pointing at the drafts' },
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

// Graph per AMC:  Draft ─► Check ─fail─► Draft (fix only failing numbers, ≤ 2 fixes) ─► Gate
// Drafts land in .claude/agent-drafts/ (gitignored); pasting them into the
// dashboard's editable summary is the user's step.

const CLI = 'npm run -s ops:agent --'
const DEFAULT_AMCS = [
  'hdfc-mutual-fund', 'icici-prudential-mutual-fund', 'sbi-mutual-fund', 'nippon-india-mutual-fund',
  'aditya-birla-sun-life-mutual-fund', 'uti-mutual-fund', 'canara-robeco-mutual-fund', 'motilal-oswal-mutual-fund',
]
const amcs = (args && args.amcs) || DEFAULT_AMCS

const DRAFT_SCHEMA = {
  type: 'object',
  properties: { draftPath: { type: 'string' }, summary: { type: 'string' } },
  required: ['draftPath', 'summary'],
}
const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'object', properties: { number: { type: 'string' }, expected: { type: 'string' }, actual: { type: 'string' }, why: { type: 'string' } }, required: ['number', 'why'] } },
  },
  required: ['pass', 'failures'],
}

const results = await pipeline(
  amcs,
  (slug) =>
    role('analyst-writer', `Draft the Fortnightly AMC Update analyst summary for "${slug}" per your instructions.`, {
      label: `draft:${slug}`, phase: 'Draft', schema: DRAFT_SCHEMA,
    }),
  async (draft, slug) => {
    if (!draft) return null
    let check = null
    for (let i = 0; i <= 2; i++) {
      check = await role('number-checker', `Check every number in the draft at ${draft.draftPath}.`, {
        label: `check:${slug}#${i + 1}`, phase: 'Check', schema: CHECK_SCHEMA,
      })
      if (!check || check.pass || i === 2) break
      await role('analyst-writer', 
        `The number-checker found these problems in your draft at ${draft.draftPath}:\n${JSON.stringify(check.failures, null, 2)}\nFix ONLY those numbers (re-fetch the cited endpoints), update the source table, and keep everything else unchanged.`,
        { label: `fix:${slug}#${i + 1}`, phase: 'Draft',  }
      )
    }
    return { slug, draftPath: draft.draftPath, summary: draft.summary, checkPassed: !!check?.pass, failures: check?.failures || [] }
  }
)

phase('Gate')
const done = results.filter(Boolean)
await agent(
  `Write one ledger row per draft, exactly like:\n${CLI} log analyst <slug> <proposal|fail> "<text>"\nUse "proposal" when checkPassed is true (text: "Draft ready for review: <draftPath>"), otherwise "fail" (text: "Draft has unverified numbers: <draftPath>").\nDrafts:\n${JSON.stringify(done.map((d) => ({ slug: d.slug, draftPath: d.draftPath, checkPassed: d.checkPassed })), null, 2)}\nDo nothing else.`,
  { label: 'ledger', model: 'haiku', effort: 'low' }
)
if (done.length < amcs.length) log(`${amcs.length - done.length} AMC draft(s) failed to produce output — see the run journal.`)
return done
