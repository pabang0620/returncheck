import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runAccountAgent } from '../server/agent/accountAgent.js'
import { buildPrompt, createAccountClient } from '../server/agent/accountClient.js'
import { withoutApiKey } from '../server/agent/accountSdk.js'
import { makeGateway, makeSession, reachSettlement, pendingOf } from './helpers.js'

// A fake Agent SDK: tool() keeps the handler, query() plays a scripted assistant that calls tools.
function fakeSdk(script, captured = {}) {
  return {
    tool: (name, description, shape, handler) => ({ name, description, shape, handler }),
    createSdkMcpServer: ({ tools }) => ({ tools }),
    query({ prompt, options }) {
      captured.options = options
      captured.prompt = prompt
      return (async function* run() {
        const tools = Object.fromEntries(Object.values(options.mcpServers).flatMap((s) => s.tools.map((t) => [t.name, t])))
        yield* script(tools)
      })()
    },
  }
}

describe('account backend (Claude Code login, no API key)', () => {
  it('strips the API key variables from the child environment', () => {
    const env = withoutApiKey({ ANTHROPIC_API_KEY: 'sk-x', ANTHROPIC_AUTH_TOKEN: 't', HOME: '/h' })
    assert.deepEqual(env, { HOME: '/h' })
  })

  it('agent loop maps SDK tool calls to the same executor and never passes the key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-must-not-leak'
    try {
      const gateway = await makeGateway()
      const session = await makeSession(gateway)
      await reachSettlement(gateway, session)
      session.approvals = []
      const captured = {}
      const sdk = fakeSdk(async function* script(tools) {
        await tools.get_rental.handler({ rental_id: 'R-1042' })
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Item 1 is accepted.' }] } }
        await tools.request_vault_charge.handler({ claim_id: session.claim.id, item_ids: ['ITEM-1'], reason: 'accepted' })
        yield { type: 'result', subtype: 'success', result: 'Charge request waiting.' }
      }, captured)
      const out = await runAccountAgent({ session, gateway }, 'settle', { sdk, model: 'claude-sonnet-5-5' })
      assert.equal(out.reply, 'Charge request waiting.')
      assert.deepEqual(out.texts.map((t) => t.text), ['Item 1 is accepted.'], 'model text is kept for recordings')
      assert.deepEqual(out.events.map((e) => [e.tool, e.ok]), [['get_rental', true], ['request_vault_charge', true]])
      assert.equal(pendingOf(session, 'vault_charge').amountCents, 3500)
      assert.equal('ANTHROPIC_API_KEY' in captured.options.env, false)
      assert.equal(captured.options.settingSources.length, 0)
      assert.deepEqual(captured.options.tools, [])
      assert.equal(captured.options.model, 'claude-sonnet-5-5')
    } finally {
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it('single turn client returns the first tool_use in Anthropic shape and flattens history', async () => {
    const captured = {}
    const sdk = fakeSdk(async function* script() {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'tu1', name: 'mcp__turn__view_schema', input: { a: 1 } }] } }
      yield { type: 'user', message: {} }
    }, captured)
    const client = createAccountClient({ sdk, model: 'm' })
    const res = await client.messages.create({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'p', name: 'x', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'p', content: 'ok' }] }],
      tools: [{ name: 'view_schema', description: 'd', input_schema: { type: 'object', properties: { a: { type: 'number' } } } }],
    })
    assert.equal(res.stop_reason, 'tool_use')
    assert.deepEqual(res.content.at(-1), { type: 'tool_use', id: 'tu1', name: 'view_schema', input: { a: 1 } })
    assert.equal('ANTHROPIC_API_KEY' in captured.options.env, false)
    const blocks = buildPrompt([{ role: 'user', content: 'hi' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'p', name: 'x', input: {} }] }])
    assert.match(blocks.map((b) => b.text).join('\n'), /assistant called tool x/)
  })

  it('image blocks stay image blocks in the prompt', () => {
    const img = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
    const blocks = buildPrompt([{ role: 'user', content: [{ type: 'text', text: 'Zone' }, img] }])
    assert.deepEqual(blocks[1], img)
  })
})
