import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { requestAction, approve } from '../server/domain/approvals.js'
import { ACTION, computeAllowedActions } from '../server/domain/allowedActions.js'
import { assertInvariants, markRefunded, netPaidCents, STATUS } from '../server/domain/claims.js'
import { staffDecideContest } from '../server/domain/service.js'
import { claudeTools, runTool } from '../server/agent/tools.js'
import { makeGateway, makeSession, pendingOf, reachSettlement } from './helpers.js'

describe('money guards', () => {
  it('rejects charge over consent limit', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session, { acceptThree: true })
    session.approvals = []
    session.claim = { ...session.claim, limitCents: 5000 }
    assert.equal(computeAllowedActions(session).some((a) => a.action === ACTION.CHARGE), false)
    assert.throws(() => requestAction(session, ACTION.CHARGE, { itemIds: ['ITEM-1', 'ITEM-3'], reason: 'x' }), (e) => e.status === 409)
  })

  it('double approve click charges once', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    const card = pendingOf(session, 'vault_charge')
    const before = gateway.client.state.calls.filter((c) => c.path === '/v2/checkout/orders' && c.method === 'POST').length
    const [a, b] = await Promise.all([approve(session, card.id, 'Mina', gateway), approve(session, card.id, 'Mina', gateway)])
    const posts = gateway.client.state.calls.filter((c) => c.path === '/v2/checkout/orders' && c.method === 'POST').length - before
    assert.equal(posts, 1)
    assert.equal(a.result.orderId, b.result.orderId)
    assert.equal(session.claim.charges.length, 1)
    assert.equal(netPaidCents(session.claim), 3500)
  })

  it('contested item cannot be charged before staff decision', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    session.approvals = []
    assert.deepEqual(computeAllowedActions(session).find((a) => a.action === ACTION.CHARGE).itemIds, ['ITEM-1'])
    assert.throws(() => requestAction(session, ACTION.CHARGE, { itemIds: ['ITEM-3'], reason: 'x' }), (e) => e.code === 'items_not_eligible' || e.extra?.code === 'items_not_eligible')
  })

  it('model request has no amount field and server recomputes from rate card', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    for (const tool of claudeTools()) {
      const keys = JSON.stringify(Object.keys(tool.input_schema.properties || {}))
      assert.doesNotMatch(keys, /amount|price|cents|total|usd|dollar/i, `${tool.name} exposes a money field`)
    }
    session.approvals = []
    const ctx = { session, gateway }
    const out = await runTool(ctx, 'request_vault_charge', { claim_id: session.claim.id, item_ids: ['ITEM-1'], reason: 'accepted', amount_cents: 999999, amount: '999.00' })
    assert.equal(out.ok, true)
    assert.equal(out.result.amount_cents_from_rate_card, 3500)
    assert.equal(pendingOf(session, 'vault_charge').amountCents, 3500)
  })

  it('pending approval makes no PayPal call', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    const callsBefore = gateway.client.state.calls.length
    session.approvals = []
    const out = await runTool({ session, gateway }, 'request_vault_charge', { claim_id: session.claim.id, item_ids: ['ITEM-1'], reason: 'accepted' })
    assert.equal(out.ok, true)
    assert.equal(gateway.client.state.calls.length, callsBefore)
    assert.equal(session.claim.charges.length, 0)
  })

  it('lost response retried with same request id returns same order', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    const card = pendingOf(session, 'vault_charge')
    gateway.client.loseNextResponse()
    const done = await approve(session, card.id, 'Mina', gateway)
    assert.equal(done.status, 'done')
    const posts = gateway.client.state.calls.filter((c) => c.method === 'POST' && c.path === '/v2/checkout/orders')
    assert.equal(posts.length, 2)
    assert.equal(posts[0].requestId, posts[1].requestId)
    assert.equal(session.claim.charges.length, 1)
  })

  it('token revoked between approval and charge blocks charge and offers invoice request', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    const card = pendingOf(session, 'vault_charge')
    session.token = { ...session.token, override: 'revoked' }
    const result = await approve(session, card.id, 'Mina', gateway)
    assert.equal(result.status, 'blocked')
    assert.match(result.error, /invoice/i)
    assert.equal(session.claim.charges.length, 0)
    const actions = computeAllowedActions(session).map((a) => a.action)
    assert.ok(actions.includes(ACTION.INVOICE))
    assert.ok(!actions.includes(ACTION.CHARGE))
  })

  it('charge action not offered when token revoked', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    session.approvals = []
    session.token = { ...session.token, status: 'revoked' }
    const actions = computeAllowedActions(session).map((a) => a.action)
    assert.ok(!actions.includes(ACTION.CHARGE))
    assert.ok(actions.includes(ACTION.INVOICE))
    const out = await runTool({ session, gateway }, 'request_vault_charge', { claim_id: session.claim.id, item_ids: ['ITEM-1'], reason: 'x' })
    assert.equal(out.ok, false)
  })

  it('charge plus partial refund keeps net equal to confirmed items', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session, { acceptThree: true })
    const charge = pendingOf(session, 'vault_charge')
    assert.deepEqual(charge.itemIds, ['ITEM-1', 'ITEM-3'])
    assert.equal(charge.amountCents, 15500)
    await approve(session, charge.id, 'Mina', gateway)
    staffDecideContest(session, 'ITEM-3', 'reduce', { reducedCents: 5000, note: 'Second look: shallow' })
    const out = await runTool({ session, gateway }, 'request_refund', { claim_id: session.claim.id, item_ids: ['ITEM-3'], reason: 'Lowered after a second look' })
    assert.equal(out.ok, true)
    assert.equal(out.result.amount_cents_from_rate_card, 7000)
    await approve(session, pendingOf(session, 'refund').id, 'Mina', gateway)
    assert.equal(netPaidCents(session.claim), 8500)
    assert.equal(session.claim.items.find((i) => i.id === 'ITEM-3').status, STATUS.REFUNDED)
    assert.ok(assertInvariants(session.claim))
  })

  it('refund cannot exceed charged amount', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    await approve(session, pendingOf(session, 'vault_charge').id, 'Mina', gateway)
    assert.throws(() => staffDecideContest(session, 'ITEM-1', 'reduce', { reducedCents: 4000 }), /lower than/)
    assert.throws(() => requestAction(session, ACTION.REFUND, { itemIds: ['ITEM-1'], reason: 'x' }), (e) => e.status === 409)
    const forced = { refundId: 'X', captureId: 'C', amountCents: 9000, status: 'COMPLETED', itemIds: ['ITEM-1'] }
    const broken = markRefunded(session.claim, [{ itemId: 'ITEM-1', cents: 9000 }], forced)
    assert.throws(() => assertInvariants(broken))
  })
})
