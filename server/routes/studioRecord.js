import { appendFileSync } from 'node:fs'

// Developer only: with RECORD_STUDIO=<file> and LLM_BACKEND=account, every Studio turn answered by the local
// Claude account is appended to that file (one JSON line per turn). The lines are then collected into
// server/demo/studioRecording.json, which the app replays when no model is connected.
export function recordStudioTurn(body, data, file = process.env.RECORD_STUDIO) {
  if (!file || data.source !== 'claude') return false
  const first = (body.input || []).find((i) => i.type === 'message' && i.role === 'user')
  const prompt = first ? first.content.map((c) => c.text || '').join('') : ''
  appendFileSync(file, `${JSON.stringify({ prompt, inputLength: (body.input || []).length, output: data.output })}\n`)
  return true
}
