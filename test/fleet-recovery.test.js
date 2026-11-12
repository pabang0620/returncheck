import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { approve } from '../server/domain/approvals.js'
import { fleetFor } from '../server/demo/fleet.js'
import { staffDecideContest } from '../server/domain/service.js'
import { runTool } from '../server/agent/tools.js'
import { makeGateway, makeSession, pendingOf, reachSettlement } from './helpers.js'

async function chargedSession() {
  const gateway = await makeGateway()
  const session = await makeSession(gateway)
  await reachSettlement(gateway, session)
  await approve(session, pendingOf(session, 'vault_charge').id, 'Mina', gateway)
  return { gateway, session }
}

async function refundItem1(gateway, session) {
  const out = await runTool({ session, gateway }, 'request_refund', { claim_id: session.claim.id, item_ids: ['ITEM-1'], reason: 'Lowered after a second look' })
  assert.equal(out.ok, true)
  await approve(session, pendingOf(session, 'refund').id, 'Mina', gateway)
}

const rowsOf = (session) => {
  const fleet = fleetFor(session, 'mock')
  const rental = fleet.rentals.find((r) => r.source.includes('this session'))
  const item = fleet.items.find((i) => i.item_id === `${rental.rental_id}-1`)
  return { rental, item }
}

describe('dashboard recovered amount is net of refunds (computed on the server)', () => {
  it('charge: ITEM-1 recovers $35.00', async () => {
    const { session } = await chargedSession()
    const { rental, item } = rowsOf(session)
    assert.equal(item.recovered_amount, 35)
    assert.equal(rental.recovered, 35)
  })

  it('partial refund: $35.00 charged minus $17.50 refunded recovers $17.50', async () => {
    const { gateway, session } = await chargedSession()
    staffDecideContest(session, 'ITEM-1', 'reduce', { reducedCents: 1750, note: 'Second look' })
    await refundItem1(gateway, session)
    const { rental, item } = rowsOf(session)
    assert.equal(item.recovered_amount, 17.5)
    assert.equal(rental.recovered, 17.5)
  })

  it('full refund: recovers $0 and the item is not counted twice', async () => {
    const { gateway, session } = await chargedSession()
    staffDecideContest(session, 'ITEM-1', 'waive', { note: 'Photo shows dust' })
    await refundItem1(gateway, session)
    const { rental, item } = rowsOf(session)
    assert.equal(item.recovered_amount, 0)
    assert.equal(rental.recovered, 0)
  })

  it('seeded history carries a recovered amount only on charged items', () => {
    const { items } = fleetFor(null, 'mock')
    assert.ok(items.every((i) => (i.state === 'charged' ? i.recovered_amount === i.amount : i.recovered_amount === 0)))
  })
})
