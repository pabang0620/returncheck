import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ANY_TOOL, createRequiringTool, withRequiredTool } from '../server/llm/requiredTool.js'
import { compareZone } from '../server/vision/compare.js'
import { runStudioTurn } from '../server/routes/studioLlm.js'

// Fake API with the real model's rule: forced tool_choice is a 400.
function fakeApi(replies) {
  const sent = []
  return {
    sent,
    messages: {
      create: async (req) => {
        sent.push(req)
        if (req.tool_choice && ['tool', 'any'].includes(req.tool_choice.type)) throw new Error('400 tool_choice: type "tool" and "any" are not supported for this model')
        return replies[Math.min(sent.length - 1, replies.length - 1)]
      },
    },
  }
}
const text = { content: [{ type: 'text', text: 'plain words' }] }
const zoneCall = { content: [{ type: 'tool_use', id: 't', name: 'report_zone', input: { verdict: 'none', confidence: 'high', note: 'clean' } }] }
const raster = (id) => ({ id, width: 800, height: 600, mediaType: 'image/jpeg', data: 'AAAA' })
const photos = { before: raster('b'), after: raster('a'), closeup: null }
const run = (anthropic) => compareZone({ setId: 'A', zone: 'top_plate', zoneLabel: 'Top plate', photos, anthropic })

describe('required tool without forced tool_choice', () => {
  it('withRequiredTool strips tool_choice and adds the instruction', () => {
    const r = withRequiredTool({ system: 's', tool_choice: { type: 'any' } }, ANY_TOOL)
    assert.equal(r.tool_choice, undefined)
    assert.match(r.system, /You must call one of the tools in this turn\./)
  })

  it('vision request never carries tool_choice and succeeds on a tool answer', async () => {
    const api = fakeApi([zoneCall])
    assert.equal((await run(api)).source, 'claude')
    assert.ok(api.sent.every((r) => r.tool_choice === undefined))
  })

  it('a text answer once triggers one retry with the instruction repeated', async () => {
    const api = fakeApi([text, zoneCall])
    assert.equal((await run(api)).source, 'claude')
    assert.equal(api.sent.length, 2)
    assert.match(api.sent[1].system, /Reminder: .*report_zone/)
  })

  it('a text answer twice falls back to the labelled seeded result', async () => {
    const api = fakeApi([text])
    const r = await run(api)
    assert.equal(r.source, 'seeded')
    assert.equal(api.sent.length, 2)
  })

  it('studio turns send no tool_choice, retry once, then fall back to the recorded note', async () => {
    const body = { input: [{ type: 'message', role: 'user', content: [{ type: 'text', text: 'x' }] }], responseFormat: { type: 'json', schema: { type: 'object', properties: {} } } }
    const good = fakeApi([{ content: [{ type: 'tool_use', id: 't', name: 'respond_json', input: { a: 1 } }] }])
    assert.equal((await runStudioTurn(body, { anthropic: good, model: 'm' })).source, 'claude')
    assert.equal(good.sent.length, 1)
    const bad = fakeApi([text])
    const out = await runStudioTurn(body, { anthropic: bad, model: 'm' })
    assert.equal(out.source, 'recorded')
    assert.ok(out.reason)
    assert.equal(bad.sent.length, 2)
    assert.ok(bad.sent.every((r) => r.tool_choice === undefined && /respond_json/.test(r.system)))
  })

  it('createRequiringTool with no required tool makes one call', async () => {
    const api = fakeApi([text])
    assert.equal(await createRequiringTool(api, { system: '' }, null), text)
    assert.equal(api.sent.length, 1)
  })
})
