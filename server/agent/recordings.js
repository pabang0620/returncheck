import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTool, traceEvent } from './tools.js'

// Recorded real model runs (C2). Each file in server/demo/recorded-runs is one run of the live agent loop
// through Claude Sonnet (account mode), with the tool calls in order, the model's text and timings. In mock mode
// a run is replayed only when the session is in exactly the state it was recorded in (scenarioKey); the tool
// calls go through the same executor, so the approval cards and items are real for this session.
export const RECORDINGS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo', 'recorded-runs')

const CLAIM_ID = /CLM-1042-[A-Z0-9]+/g
const APPROVAL_ID = /APR-[a-f0-9]{8}/g
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

// The facts a run depends on. Two sessions with the same key give the model the same tool answers.
export function scenarioKey(session, phase) {
  const parts = [phase, `set=${session.setId}`, `mode=${session.rental.mode}`]
  if (phase === 'inspect') {
    parts.push(`closeups=${[...session.inspection.closeupsUploaded].sort().join(',')}`)
    parts.push(`uploads=${Object.keys(session.uploads || {}).sort().join(',')}`)
    return parts.join('|')
  }
  parts.push(`token=${session.token ? `${session.token.kind}:${session.token.status}` : 'none'}`)
  parts.push(`charges=${session.claim.charges.length}`, `pending=${session.approvals.filter((a) => a.status === 'pending').map((a) => a.type).sort().join(',')}`)
  for (const item of session.claim.items) {
    parts.push(`${item.id}:${item.status}:${item.confirmedCents ?? ''}:${norm(item.contest?.note)}:${norm(item.contest?.photoNote)}:${norm(item.staffNote)}`)
  }
  return parts.join('|')
}

let cache = null
export function loadRecordings(dir = RECORDINGS_DIR) {
  if (cache && dir === RECORDINGS_DIR) return cache
  let files = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    files = []
  }
  const list = files.map((f) => ({ file: f, ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }))
  if (dir === RECORDINGS_DIR) cache = list
  return list
}

export function findRecording(session, phase, list = loadRecordings()) {
  const key = scenarioKey(session, phase)
  return list.find((r) => r.phase === phase && r.key === key) || null
}

const swapClaimId = (value, claimId) => {
  if (typeof value === 'string') return value.replace(CLAIM_ID, claimId)
  if (Array.isArray(value)) return value.map((v) => swapClaimId(v, claimId))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swapClaimId(v, claimId)]))
  return value
}

export function recordingLabel(rec) {
  return `Recorded run: ${rec.modelName}, ${rec.recordedAt.slice(0, 10)}`
}

// Replays one recorded run in this session. A step whose result differs from the recording (ok versus refused)
// marks the run as diverged, so the screen can say so instead of pretending.
export async function runRecordedAgent(ctx, phase, rec) {
  const events = []
  const approvalIds = new Map()
  let diverged = false
  for (const step of rec.steps) {
    const input = swapClaimId(step.input, ctx.session.claim.id)
    const out = await runTool(ctx, step.tool, input)
    if (out.ok !== step.ok) diverged = true
    const oldId = step.resultSummary?.match(APPROVAL_ID)?.[0]
    if (oldId && out.result?.approval_id) approvalIds.set(oldId, out.result.approval_id)
    events.push({ ...traceEvent(step.tool, input, out, 'replay'), atMs: step.atMs })
  }
  // The model's words are kept as recorded; only ids that belong to the recording session are swapped.
  const fix = (text) => swapClaimId(text, ctx.session.claim.id).replace(APPROVAL_ID, (id) => approvalIds.get(id) || id)
  return {
    reply: fix(rec.reply),
    events,
    source: 'replay',
    texts: (rec.texts || []).map((t) => ({ ...t, text: fix(t.text) })),
    diverged,
    recording: { label: recordingLabel(rec), model: rec.model, modelName: rec.modelName, backend: rec.backend, recordedAt: rec.recordedAt, durationMs: rec.durationMs, file: rec.file },
  }
}

// Turns a live run into a recording file body (used by scripts/record-runs.js).
export function toRecording({ id, key, phase, setId, model, modelName, backend, startedAt, finishedAt, outcome }) {
  const t0 = Date.parse(startedAt)
  return {
    id,
    key,
    phase,
    setId,
    model,
    modelName,
    backend,
    recordedAt: startedAt,
    durationMs: Date.parse(finishedAt) - t0,
    reply: outcome.reply,
    texts: (outcome.texts || []).map((t) => ({ atMs: Date.parse(t.at) - t0, text: t.text })),
    steps: outcome.events.map((e) => ({ tool: e.tool, input: e.input, ok: e.ok, resultSummary: e.resultSummary, atMs: Date.parse(e.at) - t0 })),
  }
}
