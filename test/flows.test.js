import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { once } from 'node:events'
import { createApp } from '../server/index.js'
import { ACTION, computeAllowedActions } from '../server/domain/allowedActions.js'
import { approve } from '../server/domain/approvals.js'
import { closeRental, runInspection, runSettlement } from '../server/domain/inspect.js'
import { requestCloseupUpload, renterAnswer, sendLink, staffConfirmItem } from '../server/domain/service.js'
import { runClaudeAgent } from '../server/agent/claudeAgent.js'
import { runTool } from '../server/agent/tools.js'
import { TEST_CONFIG, makeGateway, makeSession, pendingOf, reachSettlement } from './helpers.js'

describe('inspection sets', () => {
  it('set A drafts the scratch and the dent, and skips the barrel mark seen in R-0977', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    const byZone = Object.fromEntries(session.claim.items.map((i) => [i.zone, i]))
    assert.equal(byZone.top_plate.rateCode, 'SCR-S')
    assert.equal(byZone.top_plate.listCents, 3500)
    assert.equal(byZone.lens_mount.rateCode, 'DNT-M')
    assert.equal(byZone.lens_barrel.preExisting, true)
    assert.equal(byZone.lens_barrel.historyRef, 'R-0977')
    assert.equal(byZone.lens_barrel.status, 'dropped')
    assert.deepEqual(session.claim.items.map((i) => i.id), ['ITEM-1', 'ITEM-2', 'ITEM-3'])
  })

  it('set B asks for a close-up, then drafts the front element mark after the upload', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway, { setId: 'B' })
    assert.equal(session.claim.items.length, 0)
    assert.deepEqual(session.inspection.closeupsRequested, ['lens_front'])
    assert.equal(session.inspection.zones.lens_front.verdict, 'uncertain')
    requestCloseupUpload(session, 'lens_front')
    await runInspection(session, gateway, { live: false })
    assert.equal(session.claim.items.length, 1)
    assert.equal(session.claim.items[0].rateCode, 'LNS-F')
    assert.equal(session.claim.items[0].photoIds.length, 3)
  })

  it('a close-up cannot be requested twice for the same zone or for a clear zone', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway, { setId: 'B' })
    const ctx = { session, gateway }
    assert.equal((await runTool(ctx, 'request_closeup', { zone: 'top_plate', reason: 'x' })).ok, false)
    assert.equal((await runTool(ctx, 'request_closeup', { zone: 'lens_front', reason: 'x' })).ok, false)
  })

  it('set C finds nothing to bill', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway, { setId: 'C' })
    assert.ok(session.claim.items.every((i) => i.preExisting && i.status === 'dropped'))
    assert.equal(computeAllowedActions(session).some((a) => a.action === ACTION.CHARGE), false)
  })

  it('record_finding refuses a pre_existing claim without history evidence', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway, { inspect: false })
    const ctx = { session, gateway }
    await runTool(ctx, 'get_photo_pair', { rental_id: 'R-1042', zone: 'top_plate' })
    const out = await runTool(ctx, 'record_finding', { zone: 'top_plate', rate_code: 'SCR-S', description: 'x', confidence: 'high', pre_existing: true, history_ref: 'R-0977' })
    assert.equal(out.ok, false)
    const none = await runTool(ctx, 'record_finding', { zone: 'rear_lcd', rate_code: 'LCD-S', description: 'x', confidence: 'high' })
    assert.equal(none.ok, false)
  })
})

describe('demo path with doubles', () => {
  it('scratch accepted, dent contested, charge approved, dent waived, rental closed', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    assert.equal(session.holds.length, 1)
    const card = pendingOf(session, 'vault_charge')
    assert.equal(card.amountCents, 3500)
    assert.equal(card.requestedBy, 'claude')
    const done = await approve(session, card.id, 'Mina', gateway)
    assert.equal(done.status, 'done')
    assert.match(done.result.orderId, /^5O/)
    assert.deepEqual(done.result.receiptItems.map((i) => [i.name, i.cents]), [['Top plate small scratch (SCR-S)', 3500]])
    assert.equal(done.result.invoiceId, session.claim.id)
    assert.equal(done.result.requestId, `${session.claim.id}-r1`)
    assert.equal(done.result.receiptFrom, 'paypal')
    const order = await gateway.getOrder(done.result.orderId)
    assert.equal(order.purchase_units[0].items.length, 1)
    assert.throws(() => closeRental(session), /still open/)
    const { staffDecideContest } = await import('../server/domain/service.js')
    staffDecideContest(session, 'ITEM-3', 'waive', { note: 'photo shows dust, not a dent' })
    const pack = closeRental(session)
    assert.equal(pack.charges[0].amountCents, 3500)
    assert.equal(session.closed, true)
    const txns = await gateway.listTransactions()
    assert.equal(txns.total_items, 1)
  })

  it('invoice fallback: revoked token gets an approval-pending invoice, nothing is charged', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    staffConfirmItem(session, 'ITEM-1')
    staffConfirmItem(session, 'ITEM-3')
    sendLink(session)
    renterAnswer(session, 'ITEM-1', 'accept')
    renterAnswer(session, 'ITEM-3', 'contest', { note: 'dust' })
    session.token = { ...session.token, status: 'revoked', override: 'revoked' }
    await runSettlement(session, gateway, { live: false })
    assert.equal(pendingOf(session, 'vault_charge'), undefined)
    const card = pendingOf(session, 'invoice')
    assert.equal(card.amountCents, 3500)
    const callsBefore = gateway.client.state.calls.length
    const done = await approve(session, card.id, 'Mina', gateway)
    assert.equal(done.status, 'done')
    assert.match(done.result.invoiceId, /^INV2-/)
    assert.equal(gateway.client.state.calls.length, callsBefore)
    assert.equal(session.claim.charges[0].status, 'INVOICED')
    assert.equal(computeAllowedActions(session).some((a) => a.action === ACTION.INVOICE), false)
  })

  it('invoice payment mode never offers a Vault charge', async () => {
    const gateway = await makeGateway()
    const config = { ...TEST_CONFIG, paymentMode: 'invoice' }
    const session = await makeSession(gateway, { config })
    assert.equal(session.token, null)
    staffConfirmItem(session, 'ITEM-1')
    staffConfirmItem(session, 'ITEM-3')
    sendLink(session)
    renterAnswer(session, 'ITEM-1', 'accept')
    renterAnswer(session, 'ITEM-3', 'accept')
    const actions = computeAllowedActions(session).map((a) => a.action)
    assert.ok(actions.includes(ACTION.INVOICE))
    assert.ok(!actions.includes(ACTION.CHARGE))
    assert.ok(!actions.includes(ACTION.TOKEN_DELETE))
  })

  it('live Claude loop runs tools through the same executor', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    session.approvals = []
    const script = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'get_rental', input: { rental_id: 'R-1042' } }] },
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'request_vault_charge', input: { claim_id: session.claim.id, item_ids: ['ITEM-1'], reason: 'accepted' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Charge request waiting for approval.' }] },
    ]
    const seen = []
    const client = { messages: { create: async (req) => { seen.push(req); return script[seen.length - 1] } } }
    const out = await runClaudeAgent({ session, gateway }, 'settle', { client, model: 'm' })
    assert.equal(out.reply, 'Charge request waiting for approval.')
    assert.equal(out.events.length, 2)
    assert.equal(pendingOf(session, 'vault_charge').amountCents, 3500)
    assert.ok(seen[0].tools.some((t) => t.name === 'request_vault_charge'))
    assert.equal(seen[0].tools.some((t) => t.name.startsWith('vault_charge') || t.name === 'vault_delete_payment_token'), false)
  })
})

describe('HTTP API', () => {
  async function withApi(fn) {
    const { app } = await createApp()
    const server = app.listen(0)
    await once(server, 'listening')
    const base = `http://localhost:${server.address().port}/api`
    const call = async (path, { method = 'POST', key, role = 'staff', body } = {}) => {
      const headers = { 'content-type': 'application/json' }
      if (key) headers[role === 'renter' ? 'x-renter-key' : 'x-staff-key'] = key
      const res = await fetch(base + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
      return { status: res.status, json: await res.json() }
    }
    try { await fn(call) } finally { server.close() }
  }

  it('charge, reduce after a contest decision, settle again and approve the refund (no 500)', async () => {
    await withApi(async (call) => {
      const { sid, staffKey, renterKey } = (await call('/demo')).json.data
      const s = (path, body) => call(`/s/${sid}${path}`, { key: staffKey, body })
      const r = (path, body) => call(`/s/${sid}${path}`, { key: renterKey, role: 'renter', body })
      await s('/items/ITEM-1/confirm')
      await s('/items/ITEM-3/confirm')
      await s('/link')
      await r('/items/ITEM-1/answer', { answer: 'accept' })
      await r('/items/ITEM-3/answer', { answer: 'contest', note: 'dust' })
      const first = await s('/agent/settle')
      assert.equal(first.status, 200)
      const charge = first.json.data.state.approvals.find((a) => a.status === 'pending')
      assert.equal((await s(`/approvals/${charge.id}/approve`, { approver: 'Mina' })).json.data.approval.status, 'done')
      assert.equal((await s('/items/ITEM-3/decide', { decision: 'waive', note: 'dust' })).status, 200)
      assert.equal((await s('/items/ITEM-1/decide', { decision: 'reduce', reducedCents: 2000, note: 'second look' })).status, 200)
      const second = await s('/agent/settle')
      assert.equal(second.status, 200)
      assert.ok(second.json.data.state.lastAgent.events.every((e) => e.ok))
      const refund = second.json.data.state.approvals.find((a) => a.status === 'pending' && a.type === 'refund')
      assert.equal(refund.amountCents, 1500)
      const done = await s(`/approvals/${refund.id}/approve`, { approver: 'Mina' })
      assert.equal(done.json.data.approval.status, 'done')
      assert.equal(done.json.data.state.claim.netPaidCents, 2000)
    })
  })

  it('runs the judge path over HTTP with separate staff and renter keys', async () => {
    const { app } = await createApp()
    const server = app.listen(0)
    await once(server, 'listening')
    const base = `http://localhost:${server.address().port}/api`
    const call = async (path, { method = 'POST', key, role, body } = {}) => {
      const headers = { 'content-type': 'application/json' }
      if (key) headers[role === 'renter' ? 'x-renter-key' : 'x-staff-key'] = key
      const res = await fetch(base + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
      return { status: res.status, json: await res.json() }
    }
    try {
      const start = await call('/demo')
      assert.equal(start.status, 201)
      const { sid, staffKey, renterKey } = start.json.data
      const s = (path, body) => call(`/s/${sid}${path}`, { key: staffKey, role: 'staff', body })
      const r = (path, body) => call(`/s/${sid}${path}`, { key: renterKey, role: 'renter', body })
      assert.equal((await r('/inspect')).status, 403)
      assert.equal((await s('/items/ITEM-1/answer', { answer: 'accept' })).status, 403)
      assert.equal((await s('/items/ITEM-1/confirm')).status, 200)
      assert.equal((await s('/items/ITEM-3/confirm')).status, 200)
      assert.equal((await r('/items/ITEM-1/answer', { answer: 'accept' })).status, 409)
      assert.equal((await s('/link')).status, 200)
      assert.equal((await r('/items/ITEM-1/answer', { answer: 'accept' })).status, 200)
      assert.equal((await r('/items/ITEM-3/answer', { answer: 'contest', note: 'dust' })).status, 200)
      assert.equal((await r('/items/ITEM-3/answer', { answer: 'maybe' })).status, 400)
      const settled = await s('/agent/settle')
      const card = settled.json.data.state.approvals.find((a) => a.status === 'pending')
      assert.equal(card.amountCents, 3500)
      const approved = await s(`/approvals/${card.id}/approve`, { approver: 'Mina' })
      assert.equal(approved.json.data.approval.status, 'done')
      const renterView = await call(`/s/${sid}/state/renter`, { method: 'GET', key: renterKey, role: 'renter' })
      assert.equal(renterView.json.data.state.approvals, undefined)
      assert.equal(renterView.json.data.state.claim.items.length, 2)
      const other = await call('/demo')
      assert.equal(other.json.data.state.claim.items.find((i) => i.id === 'ITEM-1').status, 'draft')
      const fleet = await call(`/fleet?sid=${sid}`, { method: 'GET' })
      assert.ok(fleet.json.data.rentals.length > 60)
      assert.ok(fleet.json.data.charges.some((c) => c.paypal_order === approved.json.data.approval.result.orderId))
      const photo = await fetch(`${base}/photos/${sid}/A-after-top_plate.svg`)
      assert.equal(photo.headers.get('content-type'), 'image/svg+xml; charset=utf-8')
    } finally {
      server.close()
    }
  })
})
