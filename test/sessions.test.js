import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ACTION, computeAllowedActions } from '../server/domain/allowedActions.js'
import { approve, requestAction } from '../server/domain/approvals.js'
import { authorize, createSession } from '../server/demo/sessions.js'
import { staffConfirmItem, staffDropItem } from '../server/domain/service.js'
import { finishSave, startSave } from '../server/domain/tokenFlow.js'
import { TEST_CONFIG, makeGateway, makeSession, pendingOf, reachSettlement } from './helpers.js'

describe('judge sessions', () => {
  it('judge sessions do not share claim state', async () => {
    const gateway = await makeGateway()
    const a = await makeSession(gateway)
    const b = await makeSession(gateway)
    staffConfirmItem(a, 'ITEM-1')
    staffDropItem(a, 'ITEM-3')
    assert.equal(a.claim.items[0].status, 'staff_ok')
    assert.equal(b.claim.items[0].status, 'draft')
    assert.notEqual(a.id, b.id)
    assert.notEqual(a.claim, b.claim)
    assert.equal(b.claim.items.find((i) => i.id === 'ITEM-3').status, 'draft')
  })

  it('judge sessions get different PayPal request ids and orders', async () => {
    const gateway = await makeGateway()
    const a = await makeSession(gateway)
    const b = await makeSession(gateway)
    assert.notEqual(a.claim.id, b.claim.id)
    await reachSettlement(gateway, a)
    await reachSettlement(gateway, b, { acceptThree: true })
    const doneA = await approve(a, pendingOf(a, 'vault_charge').id, 'Mina', gateway)
    const doneB = await approve(b, pendingOf(b, 'vault_charge').id, 'Mina', gateway)
    assert.equal(doneA.status, 'done')
    assert.equal(doneB.status, 'done')
    assert.notEqual(doneA.result.orderId, doneB.result.orderId)
    assert.notEqual(doneA.result.requestId, doneB.result.requestId)
    assert.notEqual(doneA.result.invoiceId, doneB.result.invoiceId)
    assert.notEqual(doneA.result.captureId, doneB.result.captureId)
    assert.equal(doneA.result.receiptItems.reduce((t, i) => t + i.cents, 0), 3500)
    assert.equal(doneB.result.receiptItems.reduce((t, i) => t + i.cents, 0), 15500)
    assert.equal(doneA.result.receiptFrom, 'paypal')
  })

  it('a PayPal answer that differs from the approved amount is not recorded', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    const card = pendingOf(session, 'vault_charge')
    const real = gateway.chargeToken
    gateway.chargeToken = async (p) => {
      const order = await real(p)
      const unit = { ...order.purchase_units[0], amount: { currency_code: 'USD', value: '155.00' } }
      return { ...order, purchase_units: [unit] }
    }
    const done = await approve(session, card.id, 'Mina', gateway)
    assert.equal(done.status, 'failed')
    assert.match(done.error, /approved 35\.00/)
    assert.equal(session.claim.charges.length, 0)
  })

  it('staff and renter keys are separate and bound to one session', async () => {
    const a = createSession({ config: TEST_CONFIG })
    const b = createSession({ config: TEST_CONFIG })
    assert.doesNotThrow(() => authorize(a, 'staff', a.staffKey))
    assert.throws(() => authorize(a, 'staff', a.renterKey), (e) => e.status === 403)
    assert.throws(() => authorize(a, 'renter', a.staffKey), (e) => e.status === 403)
    assert.throws(() => authorize(a, 'staff', b.staffKey), (e) => e.status === 403)
    assert.throws(() => authorize(a, 'staff', undefined), (e) => e.status === 403)
  })

  it('shared demo token cannot be deleted', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    await reachSettlement(gateway, session)
    await approve(session, pendingOf(session, 'vault_charge').id, 'Mina', gateway)
    // Settle the contested item so the rental is ready to close.
    session.claim = { ...session.claim, items: session.claim.items.map((i) => (i.id === 'ITEM-3' ? { ...i, status: 'waived', confirmedCents: 0 } : i)) }
    assert.ok(!computeAllowedActions(session).some((a) => a.action === ACTION.TOKEN_DELETE))
    assert.throws(() => requestAction(session, ACTION.TOKEN_DELETE, {}), /kept for other judges/)
    // Even a hand-made card cannot delete it.
    session.approvals.push({ id: 'APR-forced', type: 'token_delete', status: 'pending', itemIds: [], amountCents: 0, allocations: [] })
    const result = await approve(session, 'APR-forced', 'Mina', gateway)
    assert.notEqual(result.status, 'done')
    assert.equal(session.token.status, 'active')
    assert.equal(gateway.client.state.calls.some((c) => c.method === 'DELETE'), false)
  })

  it('a token the judge saved can be deleted after settlement', async () => {
    const gateway = await makeGateway()
    const session = await makeSession(gateway)
    const { setupTokenId, approveUrl } = await startSave(session, gateway, TEST_CONFIG)
    assert.match(approveUrl, /mock-paypal\/approve/)
    await assert.rejects(() => finishSave(session, gateway, 'wrong'), (e) => e.status === 403)
    await finishSave(session, gateway, setupTokenId)
    assert.equal(session.token.kind, 'own')
    await reachSettlement(gateway, session)
    await approve(session, pendingOf(session, 'vault_charge').id, 'Mina', gateway)
    session.claim = { ...session.claim, items: session.claim.items.map((i) => (i.id === 'ITEM-3' ? { ...i, status: 'waived', confirmedCents: 0 } : i)) }
    const card = requestAction(session, ACTION.TOKEN_DELETE, {})
    const done = await approve(session, card.id, 'Mina', gateway)
    assert.equal(done.status, 'done')
    assert.equal(session.token.status, 'deleted')
    assert.equal(done.result.httpStatus, 204)
  })
})
