import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { approve } from '../server/domain/approvals.js'
import { runInspection, runSettlement } from '../server/domain/inspect.js'
import { requestCloseupUpload, renterAnswer, sendLink, staffConfirmItem, staffDecideContest } from '../server/domain/service.js'
import { simulateRevoke } from '../server/domain/tokenFlow.js'
import { loadRecordings, recordingLabel } from '../server/agent/recordings.js'
import { buildState, settleNeeded } from '../server/domain/view.js'
import { makeGateway, makeSession, pendingOf } from './helpers.js'

const NOTE = 'This is dust, not a dent'

async function reviewedA(gateway) {
  const s = await makeSession(gateway)
  staffConfirmItem(s, 'ITEM-1')
  staffConfirmItem(s, 'ITEM-3')
  sendLink(s)
  renterAnswer(s, 'ITEM-1', 'accept')
  renterAnswer(s, 'ITEM-3', 'contest', { note: NOTE })
  return s
}

const assertReplayed = (run) => {
  assert.equal(run.source, 'replay')
  assert.equal(run.diverged, false)
  assert.match(run.recording.label, /^Recorded run: Claude Sonnet, 2026-11-12$/)
}

describe('recorded real runs (C2)', () => {
  it('every recording names its model, backend, date and timed tool calls', () => {
    const list = loadRecordings()
    assert.equal(list.length, 7)
    for (const r of list) {
      assert.equal(r.model, 'claude-sonnet-5-5')
      assert.match(r.backend, /^account/)
      assert.ok(r.steps.length > 0 && r.steps.every((s) => Number.isFinite(s.atMs)))
      assert.ok(r.reply.length > 20)
      assert.equal(recordingLabel(r), `Recorded run: Claude Sonnet, ${r.recordedAt.slice(0, 10)}`)
    }
  })

  it('the judge path replays the recorded inspection and settlement and builds this session\'s own card', async () => {
    const gateway = await makeGateway()
    const s = await reviewedA(gateway)
    assertReplayed(s.agentRuns.inspect)
    assert.deepEqual(s.claim.items.map((i) => [i.id, i.rateCode, i.preExisting]), [['ITEM-1', 'SCR-S', false], ['ITEM-2', 'MRK-B', true], ['ITEM-3', 'DNT-M', false]])
    await runSettlement(s, gateway)
    assertReplayed(s.agentRuns.settle)
    const card = pendingOf(s, 'vault_charge')
    assert.equal(card.amountCents, 3500)
    assert.deepEqual(card.itemIds, ['ITEM-1'])
    assert.ok(s.agentRuns.settle.reply.includes(card.id), 'reply names this session\'s approval id')
    assert.ok(!/CLM-1042-/.test(s.agentRuns.settle.reply) || s.agentRuns.settle.reply.includes(s.claim.id))
    assert.equal(s.holds.length, 1)
  })

  it('refund and invoice scenes replay too', async () => {
    const gateway = await makeGateway()
    const s = await reviewedA(gateway)
    await runSettlement(s, gateway)
    await approve(s, pendingOf(s, 'vault_charge').id, 'Mina', gateway)
    staffDecideContest(s, 'ITEM-3', 'waive', { note: '' })
    staffDecideContest(s, 'ITEM-1', 'reduce', { reducedCents: 1750, note: '' })
    const view = (x) => buildState(x, 'staff', { modes: { llm: 'mock', paypal: 'mock' }, gateway })
    assert.equal(view(s).holds.length, 0, 'the hold for ITEM-3 leaves the screen once staff decided it')
    assert.equal(s.holds.length, 1, 'the hold itself stays recorded')
    await runSettlement(s, gateway)
    assertReplayed(s.agentRuns.settle)
    assert.equal(pendingOf(s, 'refund').amountCents, 1750)
    await approve(s, pendingOf(s, 'refund').id, 'Mina', gateway)
    const refund = s.approvals.find((a) => a.type === 'refund').result
    assert.equal(refund.source, 'mock')
    assert.deepEqual(refund.captureIds, [s.claim.charges[0].captureId])

    const t = await reviewedA(gateway)
    await simulateRevoke(t, gateway)
    await runSettlement(t, gateway)
    assertReplayed(t.agentRuns.settle)
    assert.equal(pendingOf(t, 'invoice').amountCents, 3500)
  })

  it('sets B and C replay, including the close-up loop', async () => {
    const gateway = await makeGateway()
    const b = await makeSession(gateway, { setId: 'B' })
    assertReplayed(b.agentRuns.inspect)
    requestCloseupUpload(b, 'lens_front')
    await runInspection(b, gateway)
    assertReplayed(b.agentRuns.inspect)
    assert.equal(b.claim.items[0].rateCode, 'LNS-F')
    const c = await makeSession(gateway, { setId: 'C' })
    assertReplayed(c.agentRuns.inspect)
    assert.ok(c.claim.items.every((i) => i.preExisting))
  })

  it('a state no recording covers runs the scripted stand-in, labelled scripted, never as a model', async () => {
    const gateway = await makeGateway()
    const s = await reviewedA(gateway)
    s.claim = { ...s.claim, items: s.claim.items.map((i) => (i.id === 'ITEM-3' ? { ...i, contest: { ...i.contest, note: 'something else' } } : i)) }
    await runSettlement(s, gateway)
    assert.equal(s.agentRuns.settle.source, 'scripted')
    assert.equal(s.agentRuns.settle.recording, null)
    assert.ok(s.agentRuns.settle.events.every((e) => e.source === 'scripted'))
  })

  it('Ask Claude to settle is only offered when it can do something (no second hold, no stale button)', async () => {
    const gateway = await makeGateway()
    const s = await reviewedA(gateway)
    assert.equal(settleNeeded(s), true)
    await runSettlement(s, gateway)
    assert.equal(settleNeeded(s), false, 'the charge card is pending and item 3 is held: approve or reject first')
    await approve(s, pendingOf(s, 'vault_charge').id, 'Mina', gateway)
    assert.equal(settleNeeded(s), false, 'item 3 is already held and nothing is payable')
    staffDecideContest(s, 'ITEM-1', 'reduce', { reducedCents: 1750, note: '' })
    assert.equal(settleNeeded(s), true, 'a refund is now allowed')
  })
})
