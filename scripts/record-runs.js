// Records the main AI scenes once through the real model (Claude Sonnet via the local Claude Code login, the
// Claude Agent SDK; never an API key) and writes them to server/demo/recorded-runs/*.json. PayPal stays mock.
// Usage: node scripts/record-runs.js [scenario ...]   (default: all scenarios, each once, one retry on error)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

process.env.LLM_BACKEND = 'account'
delete process.env.FORCE_MOCK
for (const name of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']) process.env[name] = ''

const { config } = await import('../server/config.js')
const { createGateway } = await import('../server/integrations/gateway.js')
const { createSession } = await import('../server/demo/sessions.js')
const { runInspection, runSettlement } = await import('../server/domain/inspect.js')
const { requestCloseupUpload, renterAnswer, sendLink, staffConfirmItem, staffDecideContest } = await import('../server/domain/service.js')
const { approve } = await import('../server/domain/approvals.js')
const { simulateRevoke } = await import('../server/domain/tokenFlow.js')
const { RECORDINGS_DIR, loadRecordings, scenarioKey, toRecording } = await import('../server/agent/recordings.js')

const CONTEST_NOTE = 'This is dust, not a dent'
const MODEL_NAME = 'Claude Sonnet'
const BACKEND = 'account (local Claude Code login, Claude Agent SDK)'
const write = (text) => process.stdout.write(`${text}\n`)

if (config.llmBackend !== 'account') throw new Error('Account backend is not on; refusing to record.')
const gateway = await createGateway({ config: {} })
if (gateway.mode !== 'mock') throw new Error('PayPal is not on the mock gateway; refusing to record.')
gateway.seedDemoToken(config.demoTokenId)

mkdirSync(RECORDINGS_DIR, { recursive: true })
const recorded = [...loadRecordings(RECORDINGS_DIR)]
const offline = { live: false, recordings: recorded }

const newSession = (setId) => createSession({ config, setId })
async function setAReviewed() {
  const s = newSession('A')
  await runInspection(s, gateway, offline)
  staffConfirmItem(s, 'ITEM-1')
  staffConfirmItem(s, 'ITEM-3')
  sendLink(s)
  renterAnswer(s, 'ITEM-1', 'accept')
  renterAnswer(s, 'ITEM-3', 'contest', { note: CONTEST_NOTE })
  return s
}

// Each scenario returns the session in the state just before the recorded run, and which phase to run.
const SCENARIOS = {
  'inspect-A': async () => ({ session: newSession('A'), phase: 'inspect' }),
  'inspect-B': async () => ({ session: newSession('B'), phase: 'inspect' }),
  'inspect-B-closeup': async () => {
    const s = newSession('B')
    await runInspection(s, gateway, offline)
    requestCloseupUpload(s, 'lens_front')
    return { session: s, phase: 'inspect' }
  },
  'inspect-C': async () => ({ session: newSession('C'), phase: 'inspect' }),
  'settle-charge': async () => ({ session: await setAReviewed(), phase: 'settle' }),
  'settle-refund': async () => {
    const s = await setAReviewed()
    await runSettlement(s, gateway, offline)
    const card = s.approvals.find((a) => a.status === 'pending' && a.type === 'vault_charge')
    if (!card) throw new Error('settle-charge replay did not leave a charge card')
    await approve(s, card.id, 'Mina', gateway)
    staffDecideContest(s, 'ITEM-3', 'waive', { note: '' })
    staffDecideContest(s, 'ITEM-1', 'reduce', { reducedCents: 1750, note: '' })
    return { session: s, phase: 'settle' }
  },
  'settle-invoice': async () => {
    const s = await setAReviewed()
    await simulateRevoke(s, gateway)
    return { session: s, phase: 'settle' }
  },
}

async function recordOne(id) {
  const { session, phase } = await SCENARIOS[id]()
  const key = scenarioKey(session, phase)
  const startedAt = new Date().toISOString()
  const run = phase === 'inspect' ? runInspection : runSettlement
  const outcome = await run(session, gateway, { live: true })
  const finishedAt = new Date().toISOString()
  if (outcome.source !== 'claude' || outcome.offline) throw new Error(`model did not answer (${session.activity.at(-1)?.text || 'no log'})`)
  return { ...toRecording({ id, key, phase, setId: session.setId, model: config.anthropicModel, modelName: MODEL_NAME, backend: BACKEND, startedAt, finishedAt, outcome }), approvalsAfter: session.approvals.map((a) => ({ type: a.type, status: a.status, amountCents: a.amountCents, itemIds: a.itemIds })) }
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS)
for (const id of wanted) {
  if (!SCENARIOS[id]) throw new Error(`Unknown scenario ${id}`)
  const file = join(RECORDINGS_DIR, `${id}.json`)
  if (existsSync(file)) { write(`${id}: exists, skipped (remove the file to record again)`); continue }
  let rec = null
  for (let attempt = 1; attempt <= 2 && !rec; attempt += 1) {
    try {
      rec = await recordOne(id)
    } catch (err) {
      write(`${id}: attempt ${attempt} failed: ${err.message}`)
    }
  }
  if (!rec) continue
  writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`)
  recorded.push({ file: `${id}.json`, ...rec })
  write(`${id}: ${rec.steps.length} tool calls in ${(rec.durationMs / 1000).toFixed(1)} s: ${rec.steps.map((s) => s.tool).join(', ')}`)
}
