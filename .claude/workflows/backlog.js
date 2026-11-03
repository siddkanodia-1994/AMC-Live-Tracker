export const meta = {
  name: 'backlog',
  description: 'Partition BACKLOG.md "Ready" items into file-disjoint lanes and run dev-loop on every lane in parallel worktrees; returns one branch per lane for your merge/push decision',
  whenToUse: 'When several independent code tasks are ready. Optional args: {"items": ["task", ...], "maxLanes": 3}. Default: read the "## Ready" section of BACKLOG.md.',
  phases: [
    { title: 'Partition', detail: 'group items into lanes with disjoint files' },
    { title: 'Lanes', detail: 'dev-loop per lane, all lanes concurrently' },
    { title: 'Ledger', detail: 'one proposal row per lane' },
  ],
}

// Graph:  Partition ─► lane₁ ─┐
//                    ─► lane₂ ─┼─► (each lane = dev-loop: plan → implement[worktree] → verify⟲ → review⟲)
//                    ─► laneₙ ─┘                                    ─► Ledger (proposal per lane)
// Lanes never share a file, so their branches merge independently; items
// that would touch the same files are put in ONE lane and done in order.
// Nothing here merges or pushes — the agent gate blocks push, and merging
// lane branches stays the user's decision.

const CLI = 'npm run -s ops:agent --'
const maxLanes = (args && args.maxLanes) || 3

const PARTITION_SCHEMA = {
  type: 'object',
  properties: {
    lanes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short kebab-case lane name' },
          task: { type: 'string', description: 'the full task for this lane; several items joined in execution order if they share files' },
          files: { type: 'array', items: { type: 'string' }, description: 'files/dirs this lane is expected to touch' },
          items: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'task', 'files', 'items'],
      },
    },
    notReady: {
      type: 'array',
      items: { type: 'object', properties: { item: { type: 'string' }, reason: { type: 'string' } }, required: ['item', 'reason'] },
      description: 'items that need a user decision, data writes, or are blocked on an external date/event',
    },
  },
  required: ['lanes', 'notReady'],
}

phase('Partition')
const source = args && args.items
  ? `These backlog items:\n${args.items.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
  : 'The items under the "## Ready" heading of BACKLOG.md in the repo root (read the file; ignore other sections).'
const partition = await agent(
  `${source}\n\nFor each item, read enough code to name the files it will touch. Then group the items into lanes so that NO two lanes touch the same file (merge overlapping items into one lane, in a sensible order). ` +
    `Only code changes verifiable by tsc/lint/tests/build belong in a lane; anything needing a user decision, a production data write, a migration, or an external event goes to notReady with the reason. ` +
    `Prefer fewer, cleanly separated lanes over many tangled ones.`,
  { label: 'partition', agentType: 'Plan', schema: PARTITION_SCHEMA }
)

const lanes = (partition?.lanes || []).slice(0, maxLanes)
const deferred = (partition?.lanes || []).slice(maxLanes)
if (deferred.length) log(`Running ${lanes.length} lanes; deferred ${deferred.length} beyond maxLanes=${maxLanes}: ${deferred.map((l) => l.id).join(', ')}`)
if ((partition?.notReady || []).length) log(`Not ready: ${partition.notReady.map((n) => `${n.item} (${n.reason})`).join('; ')}`)
if (!lanes.length) {
  log('No ready lanes.')
  return { lanes: [], deferred, notReady: partition?.notReady || [] }
}

phase('Lanes')
const results = await parallel(
  lanes.map((lane) => () =>
    workflow('dev-loop', { task: `${lane.task}\n\nStay within these files unless unavoidable: ${lane.files.join(', ')}. Other lanes are changing other files in parallel.`, base: 'main' })
      .then((r) => ({ lane: lane.id, items: lane.items, ...r }))
      .catch((err) => ({ lane: lane.id, items: lane.items, ready: false, error: String(err && err.message) }))
  )
)

phase('Ledger')
const done = results.filter(Boolean)
await agent(
  `Write one ledger row per lane, exactly like:\n${CLI} log dev-loop <lane> <proposal|fail> "<text>"\n` +
    `Use "proposal" with text "Branch <branch> ready to merge: <items>" when ready is true, otherwise "fail" with "Not ready: <short reason>".\n` +
    `Lanes:\n${JSON.stringify(done.map((d) => ({ lane: d.lane, ready: d.ready, branch: d.branch, items: d.items, reason: d.error || d.verify?.failures || (d.review && d.review.verdict) })), null, 2)}\nDo nothing else.`,
  { label: 'ledger', model: 'haiku', effort: 'low' }
)
return { lanes: done.map((d) => ({ lane: d.lane, ready: d.ready, branch: d.branch, worktreePath: d.worktreePath, items: d.items })), deferred, notReady: partition?.notReady || [] }
