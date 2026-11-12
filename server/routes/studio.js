import express from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { getLlmClient, liveGuard } from '../agent/index.js'
import { getSession } from '../demo/sessions.js'
import { FALLBACK_REASON } from '../llm/liveGuard.js'
import { HttpError, parse } from '../http.js'
import { runStudioTurn } from './studioLlm.js'
import { recordStudioTurn } from './studioRecord.js'

const MAX_TURNS_PER_SESSION = 60
const MAX_TRACKED_SESSIONS = 2000
// Turns of one session that follow each other within this gap belong to one user action. A prompt makes several
// model turns (tool calls, and AG Studio's sub-agents each start their own conversation), so turns cannot be
// counted as runs one by one.
const ACTION_GAP_MS = 90 * 1000
const turns = new Map()

const bodySchema = z.object({
  instructions: z.string().max(40000).optional(),
  input: z.array(z.record(z.string(), z.any())).max(200),
  tools: z.array(z.object({ name: z.string(), description: z.string().default(''), parameters: z.any().optional() }).passthrough()).max(60).optional(),
  toolChoice: z.any().optional(),
  responseFormat: z.any().optional(),
})

// Server proxy for the Studio agent: the Anthropic key never reaches the browser. With a model connected it needs
// a live demo session id, counts turns per session and counts agent actions against the live caps. Without a
// model, with a full cap or after a failed call it replays the recorded run or a fixed note and names the reason.
export function studioRouter({ client = null, guard = liveGuard, now = Date.now } = {}) {
  const router = express.Router()
  const actions = new Map()
  const decide = (sid, ip) => {
    const t = now()
    const used = (turns.get(sid) || 0) + 1
    turns.set(sid, used)
    const current = actions.get(sid)
    let decision = current && t - current.lastAt <= ACTION_GAP_MS ? current.decision : null
    if (!decision) {
      const slot = guard.acquire(ip)
      decision = slot.ok ? { reason: null } : { reason: slot.reason }
    }
    actions.delete(sid)
    actions.set(sid, { decision, lastAt: t })
    if (actions.size > MAX_TRACKED_SESSIONS) actions.delete(actions.keys().next().value)
    return used > MAX_TURNS_PER_SESSION ? { reason: FALLBACK_REASON.LIMIT } : decision
  }
  router.post('/llm', express.json({ limit: '400kb' }), async (req, res, next) => {
    try {
      const sid = String(req.query.sid || '')
      const live = client || getLlmClient()
      const body = parse(bodySchema, req.body)
      let reason = null
      if (live) {
        if (!getSession(sid)) throw new HttpError(403, 'Open the dashboard from a demo rental first.')
        reason = decide(sid, req.ip).reason
      }
      const data = await runStudioTurn(body, { anthropic: live, model: config.anthropicModel, reason })
      if (live && live.kind === 'account' && data.source === 'claude') recordStudioTurn(body, data)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  })
  return router
}
