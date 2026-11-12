import express from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { getLlmClient } from '../agent/index.js'
import { getSession } from '../demo/sessions.js'
import { HttpError, parse } from '../http.js'
import { runStudioTurn } from './studioLlm.js'
import { recordStudioTurn } from './studioRecord.js'

const MAX_TURNS_PER_SESSION = 60
const turns = new Map()

const bodySchema = z.object({
  instructions: z.string().max(40000).optional(),
  input: z.array(z.record(z.string(), z.any())).max(200),
  tools: z.array(z.object({ name: z.string(), description: z.string().default(''), parameters: z.any().optional() }).passthrough()).max(60).optional(),
  toolChoice: z.any().optional(),
  responseFormat: z.any().optional(),
})

// Server proxy for the Studio agent: the Anthropic key never reaches the browser. With a model connected it needs
// a live demo session id and counts turns per session. Without one it only replays the recorded run or a fixed
// note, which costs nothing, so the dashboard opened from the start page works too.
export function studioRouter({ client = null } = {}) {
  const router = express.Router()
  router.post('/llm', express.json({ limit: '400kb' }), async (req, res, next) => {
    try {
      const sid = String(req.query.sid || '')
      const live = client || getLlmClient()
      if (live) {
        if (!getSession(sid)) throw new HttpError(403, 'Open the dashboard from a demo rental first.')
        const used = (turns.get(sid) || 0) + 1
        if (used > MAX_TURNS_PER_SESSION) throw new HttpError(429, 'Studio agent turn limit reached for this demo rental.')
        turns.set(sid, used)
      }
      const body = parse(bodySchema, req.body)
      const data = await runStudioTurn(body, { anthropic: live, model: config.anthropicModel })
      if (live && live.kind === 'account') recordStudioTurn(body, data)
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  })
  return router
}
