import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { once } from 'node:events'
import express from 'express'
import { FALLBACK_REASON, createLiveGuard, readLiveLimits } from '../server/llm/liveGuard.js'
import { runAgent } from '../server/agent/index.js'
import { runStudioTurn } from '../server/routes/studioLlm.js'
import { studioRouter } from '../server/routes/studio.js'
import { compareZone } from '../server/vision/compare.js'
import { errorHandler } from '../server/http.js'
import { createSession } from '../server/demo/sessions.js'
import { TEST_CONFIG, makeGateway } from './helpers.js'

const HOUR = 3600 * 1000
const clock = (start = 1_000_000) => {
  let t = start
  return { now: () => t, tick: (ms) => { t += ms } }
}
const throwingClient = (calls = []) => ({ messages: { create: async () => { calls.push(1); throw new Error('529 overloaded: sk-secret-detail') } } })
const msg = (role, text) => ({ id: 'm', kind: 'input', type: 'message', role, content: [{ type: 'text', text }], status: 'completed' })

describe('live model caps', () => {
  it('reads the limits from env with the brief defaults', () => {
    assert.deepEqual(readLiveLimits({}), { perIpHour: 10, perDay: 150 })
    assert.deepEqual(readLiveLimits({ LLM_LIVE_PER_IP_HOUR: '3', LLM_LIVE_PER_DAY: '7' }), { perIpHour: 3, perDay: 7 })
    assert.deepEqual(readLiveLimits({ LLM_LIVE_PER_IP_HOUR: 'x', LLM_LIVE_PER_DAY: '0' }), { perIpHour: 10, perDay: 150 })
  })

  it('per-IP hourly window frees up as the fake clock moves, and other IPs are not affected', () => {
    const c = clock()
    const guard = createLiveGuard({ perIpHour: 2, perDay: 100, now: c.now })
    assert.equal(guard.acquire('1.1.1.1').ok, true)
    c.tick(10 * 60 * 1000)
    assert.equal(guard.acquire('1.1.1.1').ok, true)
    const denied = guard.acquire('1.1.1.1')
    assert.deepEqual([denied.ok, denied.reason], [false, FALLBACK_REASON.LIMIT])
    assert.equal(guard.acquire('2.2.2.2').ok, true)
    c.tick(51 * 60 * 1000)
    assert.equal(guard.acquire('1.1.1.1').ok, true, 'the first hit is older than one hour now')
    assert.equal(guard.acquire('1.1.1.1').ok, false, 'the second hit is still inside the hour')
  })

  it('per-host daily cap holds across IPs and resets after 24 hours; denied attempts use nothing', () => {
    const c = clock()
    const guard = createLiveGuard({ perIpHour: 10, perDay: 3, now: c.now })
    assert.equal(guard.acquire('a').ok && guard.acquire('b').ok && guard.acquire('c').ok, true)
    for (let i = 0; i < 5; i += 1) assert.equal(guard.acquire('d').ok, false)
    assert.equal(guard.usage('d').ip, 0)
    c.tick(5 * HOUR)
    assert.equal(guard.acquire('a').ok, false, 'still the same day window')
    c.tick(20 * HOUR)
    assert.equal(guard.acquire('a').ok, true)
  })
})

describe('fallback when the model fails or a cap is full', () => {
  it('an agent run whose model call throws still completes on the recorded run, with the reason and no raw error', async () => {
    const gateway = await makeGateway()
    const session = createSession({ config: TEST_CONFIG, setId: 'A' })
    const calls = []
    const guard = createLiveGuard({ perIpHour: 5, perDay: 5 })
    const out = await runAgent({ session, gateway, phase: 'inspect', live: true, client: throwingClient(calls), guard, clientIp: '9.9.9.9' })
    assert.equal(calls.length, 1)
    assert.equal(out.source, 'replay')
    assert.equal(out.fallbackReason, FALLBACK_REASON.ERROR)
    assert.match(out.recording.label, /Recorded run/)
    assert.ok(session.claim.items.length > 0, 'the action completed')
    assert.ok(session.activity.every((l) => !/sk-secret|529/.test(JSON.stringify(l))), 'the raw error is not shown')
  })

  it('a full cap skips the model entirely and says "live limit reached"', async () => {
    const gateway = await makeGateway()
    const calls = []
    const guard = createLiveGuard({ perIpHour: 1, perDay: 100 })
    const a = createSession({ config: TEST_CONFIG, setId: 'A' })
    await runAgent({ session: a, gateway, phase: 'inspect', live: true, client: throwingClient(calls), guard, clientIp: 'ip' })
    const b = createSession({ config: TEST_CONFIG, setId: 'A' })
    const out = await runAgent({ session: b, gateway, phase: 'inspect', live: true, client: throwingClient(calls), guard, clientIp: 'ip' })
    assert.equal(calls.length, 1, 'the second run never reached the model')
    assert.equal(out.fallbackReason, FALLBACK_REASON.LIMIT)
    assert.equal(out.source, 'replay')
  })

  it('a state without a recording falls back to the rule-based stand-in with the reason on its label', async () => {
    const gateway = await makeGateway()
    const session = createSession({ config: TEST_CONFIG, setId: 'A' })
    const guard = createLiveGuard({ perIpHour: 0, perDay: 0 })
    const out = await runAgent({ session, gateway, phase: 'inspect', live: true, client: throwingClient(), guard, recordings: [] })
    assert.equal(out.source, 'scripted')
    assert.equal(out.fallbackReason, FALLBACK_REASON.LIMIT)
    assert.equal(session.approvals.length, 0)
  })

  it('one failed vision call falls back to the seeded zone result, labelled seeded', async () => {
    const raster = { mediaType: 'image/png', data: 'AAAA', width: 1200, height: 900, sharpness: 80 }
    const r = await compareZone({ setId: 'A', zone: 'top_plate', zoneLabel: 'Top plate', photos: { before: raster, after: raster, closeup: null }, anthropic: throwingClient() })
    assert.equal(r.source, 'seeded')
  })

  it('a Studio turn whose model call throws answers with a recorded note and the reason', async () => {
    const out = await runStudioTurn({ input: [msg('user', 'something else')] }, { anthropic: throwingClient(), model: 'm' })
    assert.equal(out.source, 'recorded')
    assert.equal(out.reason, FALLBACK_REASON.ERROR)
    assert.doesNotMatch(JSON.stringify(out), /sk-secret|529/)
    const rec = await runStudioTurn({ input: [msg('user', 'Add a new bar chart of net recovered dollars (charged minus refunds) by gear category')] }, { anthropic: throwingClient(), model: 'm' })
    assert.equal(rec.output[0].name, 'delegate_to', 'the recorded run is used when one exists')
  })

  it('the Studio proxy counts one slot per action (turns close together), then falls back at the cap', async () => {
    const c = clock()
    const guard = createLiveGuard({ perIpHour: 1, perDay: 100, now: c.now })
    const used = []
    const fake = { messages: { create: async () => { used.push(1); return { content: [{ type: 'text', text: 'hi' }] } } } }
    const app = express()
    app.use('/api/studio', studioRouter({ client: fake, guard, now: c.now }))
    app.use(errorHandler)
    const server = app.listen(0)
    await once(server, 'listening')
    const url = (sid) => `http://localhost:${server.address().port}/api/studio/llm?sid=${sid}`
    const post = async (sid) => (await fetch(url(sid), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: [msg('user', 'x')] }) })).json()
    try {
      const s1 = createSession({ config: TEST_CONFIG })
      assert.equal((await post(s1.id)).data.source, 'claude')
      c.tick(5000)
      assert.equal((await post(s1.id)).data.source, 'claude', 'a follow-up turn of the same action')
      assert.equal(used.length, 2)
      c.tick(5 * 60 * 1000)
      const limited = (await post(s1.id)).data
      assert.deepEqual([limited.source, limited.reason], ['recorded', FALLBACK_REASON.LIMIT])
      assert.equal(used.length, 2)
    } finally {
      server.close()
    }
  })
})
