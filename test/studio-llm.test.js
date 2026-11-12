import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { once } from 'node:events'
import express from 'express'
import { fromAnthropicContent, requiredToolOf, runStudioTurn, toAnthropicRequest } from '../server/routes/studioLlm.js'
import { studioRouter } from '../server/routes/studio.js'
import { errorHandler } from '../server/http.js'
import { createSession } from '../server/demo/sessions.js'
import { TEST_CONFIG } from './helpers.js'

const msg = (role, text) => ({ id: 'm', kind: 'input', type: 'message', role, content: [{ type: 'text', text }], status: 'completed' })

describe('AG Studio Claude adapter (server side)', () => {
  it('maps conversation items and tool results to alternating Anthropic messages', () => {
    const req = toAnthropicRequest({
      instructions: 'be brief',
      input: [
        msg('system', 'sys'), msg('user', 'hi'),
        { id: 'f', kind: 'output', type: 'function_call', callId: 'c1', name: 'run_query', arguments: '{"q":1}' },
        { type: 'function_call_output', callId: 'c1', output: '[1,2]', status: 'completed' },
      ],
      tools: [{ name: 'run_query', description: 'd', parameters: { type: 'object', properties: { q: { type: 'number' } } } }],
    })
    assert.match(req.system, /be brief[\s\S]*sys/)
    assert.deepEqual(req.messages.map((m) => m.role), ['user', 'assistant', 'user'])
    assert.equal(req.messages[1].content[0].type, 'tool_use')
    assert.equal(req.messages[2].content[0].tool_use_id, 'c1')
    assert.equal(req.tools[0].name, 'run_query')
  })

  it('json response format forces a tool and returns the JSON as text', () => {
    const req = toAnthropicRequest({ input: [msg('user', 'x')], responseFormat: { type: 'json', name: 'out', schema: { type: 'object', properties: {} } } })
    assert.equal(req.tool_choice, undefined)
    assert.equal(requiredToolOf({ responseFormat: { type: 'json' } }), 'respond_json')
    const out = fromAnthropicContent([{ type: 'tool_use', id: 't', name: 'respond_json', input: { a: 1 } }], { json: true })
    assert.equal(out[0].content[0].text, '{"a":1}')
  })

  it('maps tool_use blocks back to function_call items', () => {
    const out = fromAnthropicContent([{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't9', name: 'x', input: { k: 2 } }])
    assert.equal(out[0].type, 'message')
    assert.deepEqual([out[1].type, out[1].callId, out[1].arguments], ['function_call', 't9', '{"k":2}'])
  })

  it('answers with a recorded reply when no Claude client exists, and calls Claude when one does', async () => {
    const offline = await runStudioTurn({ input: [msg('user', 'x')] }, { anthropic: null, model: 'm' })
    assert.equal(offline.source, 'recorded')
    const seen = []
    const anthropic = { messages: { create: async (r) => { seen.push(r); return { content: [{ type: 'text', text: 'hello' }] } } } }
    const live = await runStudioTurn({ input: [msg('user', 'x')] }, { anthropic, model: 'claude-x' })
    assert.equal(live.source, 'claude')
    assert.equal(seen[0].model, 'claude-x')
  })

  it('the recorded run replays a live Claude session that adds a bar chart through delegate_to', async () => {
    const first = await runStudioTurn({ input: [msg('user', 'Add a new bar chart of net recovered dollars (charged minus refunds) by gear category')] }, { anthropic: null, model: 'm' })
    assert.equal(first.source, 'recorded')
    assert.equal(first.output[0].type, 'function_call')
    assert.equal(first.output[0].name, 'delegate_to')
    assert.match(first.output[0].arguments, /"id":"page"/)
    const widget = (await import('../server/demo/studioRecording.json', { with: { type: 'json' } })).default.turns
    assert.deepEqual(widget.filter((t) => t.output[0].name === 'delegate_to').map((t) => JSON.parse(t.output[0].arguments).type.id), ['page', 'widget'])
    assert.ok(widget.some((t) => t.output.some((o) => o.name === 'add_widget')))
    const other = await runStudioTurn({ input: [msg('user', 'something else')] }, { anthropic: null, model: 'm' })
    assert.equal(other.output[0].type, 'message')
  })

  it('the proxy needs a live demo session when a model is connected, and replays without one otherwise', async () => {
    const fake = { messages: { create: async () => ({ content: [{ type: 'text', text: 'hi' }] }) } }
    const app = express()
    app.use('/api/studio/live', studioRouter({ client: fake }))
    app.use('/api/studio', studioRouter({}))
    app.use(errorHandler)
    const server = app.listen(0)
    await once(server, 'listening')
    const base = `http://localhost:${server.address().port}/api/studio/llm`
    try {
      const body = JSON.stringify({ input: [msg('user', 'x')] })
      const denied = await fetch(base.replace('/api/studio/', '/api/studio/live/') + '?sid=nope', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      assert.equal(denied.status, 403)
      const noSession = await fetch(`${base}?sid=nope`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      assert.equal(noSession.status, 200)
      const session = createSession({ config: TEST_CONFIG })
      const ok = await fetch(`${base}?sid=${session.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      assert.equal(ok.status, 200)
      assert.equal((await ok.json()).data.source, 'recorded')
    } finally {
      server.close()
    }
  })
})
