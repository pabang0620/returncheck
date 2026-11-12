import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { once } from 'node:events'
import zlib from 'node:zlib'
import { createApp } from '../server/index.js'
import { inspectRaster } from '../server/domain/rasterPhoto.js'
import { renderEvidenceHtml } from '../server/domain/evidenceHtml.js'
import { runMockAgent } from '../server/agent/mockAgent.js'
import { approve } from '../server/domain/approvals.js'
import { closeRental } from '../server/domain/inspect.js'
import { staffDecideContest } from '../server/domain/service.js'
import { makeGateway, makeSession, pendingOf, reachSettlement } from './helpers.js'

function tinyPng(w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const chunk = (type, data) => Buffer.concat([Buffer.alloc(4), Buffer.from(type), data, Buffer.alloc(4)])
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(10)))])
}

describe('photo upload and evidence page', () => {
  it('reads PNG size from the header and rejects a wrong media type or a non-image', () => {
    const b64 = tinyPng(640, 480).toString('base64')
    assert.deepEqual(inspectRaster(b64, 'image/png'), { mediaType: 'image/png', width: 640, height: 480 })
    assert.throws(() => inspectRaster(b64, 'image/jpeg'), (e) => e.status === 400)
    assert.throws(() => inspectRaster(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64'), 'image/png'), (e) => e.status === 400)
  })

  it('upload is staff only and stores the media type; the evidence page needs a closed rental', async () => {
    const { app } = await createApp()
    const server = app.listen(0)
    await once(server, 'listening')
    const base = `http://localhost:${server.address().port}/api`
    try {
      const demo = (await (await fetch(`${base}/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).data
      const post = (key, body) => fetch(`${base}/s/${demo.sid}/photos/top_plate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-staff-key': key }, body: JSON.stringify(body) })
      const good = { kind: 'after', mediaType: 'image/png', data: tinyPng(600, 400).toString('base64') }
      assert.equal((await post(demo.renterKey, good)).status, 403)
      const ok = await post(demo.staffKey, good)
      assert.equal(ok.status, 200)
      assert.equal((await ok.json()).data.photo.width, 600)
      assert.equal((await post(demo.staffKey, { ...good, mediaType: 'image/jpeg' })).status, 400)
      const early = await fetch(`${base}/s/${demo.sid}/evidence.html`, { headers: { 'x-staff-key': demo.staffKey } })
      assert.equal(early.status, 409)
    } finally {
      server.close()
    }
  })

  it('evidence page lists items, approvals and PayPal ids, and escapes renter text', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    session.claim = { ...session.claim, items: session.claim.items.map((i) => (i.id === 'ITEM-3' ? { ...i, contest: { note: '<script>x</script>', photoNote: '' } } : i)) }
    const done = await approve(session, pendingOf(session, 'vault_charge').id, 'Mina', gateway)
    staffDecideContest(session, 'ITEM-3', 'waive', { note: 'dust' })
    closeRental(session)
    const html = renderEvidenceHtml(session)
    assert.ok(html.includes(done.result.orderId))
    assert.ok(html.includes(session.claim.id))
    assert.ok(!html.includes('<script>x'))
  })

  it('trace events carry a one line summary of the input and the result', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    session.approvals = []
    const out = await runMockAgent({ session, gateway }, 'settle')
    const charge = out.events.find((e) => e.tool === 'request_vault_charge')
    assert.match(charge.resultSummary, /pending, nothing sent to PayPal/)
    assert.ok(out.events.every((e) => e.inputSummary && e.resultSummary && e.at))
  })
})

describe('dispute watch', () => {
  it('finds a dispute on this rental capture only, is read only, and refuses without a charge', async () => {
    const { checkDisputes, simulateDispute } = await import('../server/domain/disputes.js')
    const gateway = await makeGateway()
    const mine = await makeSession(gateway)
    const other = await makeSession(gateway)
    await assert.rejects(() => checkDisputes(mine, gateway), (e) => e.status === 409)
    await reachSettlement(gateway, mine)
    await approve(mine, pendingOf(mine, 'vault_charge').id, 'Mina', gateway)
    const clean = await checkDisputes(mine, gateway)
    assert.equal(clean.found.length, 0)
    simulateDispute(mine, gateway)
    const hit = await checkDisputes(mine, gateway)
    assert.equal(hit.found.length, 1)
    assert.equal(hit.found[0].captureId, mine.claim.charges[0].captureId)
    assert.equal(hit.found[0].amount, '35.00 USD')
    // The other session has its own captures, so the same dispute list shows nothing for it.
    await reachSettlement(gateway, other)
    await approve(other, pendingOf(other, 'vault_charge').id, 'Mina', gateway)
    assert.equal((await checkDisputes(other, gateway)).found.length, 0)
    const tools = gateway.calls.map((c) => c.tool)
    assert.ok(tools.includes('list_disputes') && tools.includes('get_dispute'))
    assert.ok(!tools.some((t) => /accept|answer|close/.test(t)))
  })
})

describe('pickup record and uploaded photos', () => {
  it('shows six pickup zones, serves an uploaded photo to staff only, and marks it as uploaded', async () => {
    const { app } = await createApp()
    const server = app.listen(0)
    await once(server, 'listening')
    const base = `http://localhost:${server.address().port}/api`
    try {
      const demo = (await (await fetch(`${base}/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).data
      assert.equal(demo.state.pickup.zones.length, 6)
      assert.ok(demo.state.pickup.zones.every((z) => z.source === 'seeded' && z.url))
      const png = tinyPng(600, 400).toString('base64')
      const up = await fetch(`${base}/s/${demo.sid}/photos/lens_front`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-staff-key': demo.staffKey }, body: JSON.stringify({ kind: 'before', mediaType: 'image/png', data: png }) })
      const zone = (await up.json()).data.state.pickup.zones.find((z) => z.zone === 'lens_front')
      assert.equal(zone.source, 'uploaded')
      assert.equal(zone.url, null)
      const get = (key) => fetch(`${base}/s/${demo.sid}/uploads/before/lens_front`, { headers: { 'x-staff-key': key } })
      assert.equal((await get(demo.renterKey)).status, 403)
      const ok = await get(demo.staffKey)
      assert.equal(ok.status, 200)
      assert.equal(ok.headers.get('content-type'), 'image/png')
      assert.equal(ok.headers.get('x-content-type-options'), 'nosniff')
      assert.equal((await fetch(`${base}/s/${demo.sid}/uploads/before/top_plate`, { headers: { 'x-staff-key': demo.staffKey } })).status, 404)
    } finally {
      server.close()
    }
  })
})
