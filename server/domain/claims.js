import { priceOf, labelOf, RATE_CARD } from './rateCard.js'
import { sum } from './money.js'

// Item states: draft -> staff_ok | dropped; staff_ok -> accepted | contested;
// contested -> staff_upheld | reduced | waived; accepted | staff_upheld | reduced -> charged;
// charged -> refunded after a staff reduction and a refund.
export const STATUS = Object.freeze({
  DRAFT: 'draft',
  DROPPED: 'dropped',
  STAFF_OK: 'staff_ok',
  ACCEPTED: 'accepted',
  CONTESTED: 'contested',
  UPHELD: 'staff_upheld',
  REDUCED: 'reduced',
  WAIVED: 'waived',
  CHARGED: 'charged',
  REFUNDED: 'refunded',
})

const PAYABLE = new Set([STATUS.ACCEPTED, STATUS.UPHELD, STATUS.REDUCED])
const DECIDED_AFTER_CONTEST = new Set([STATUS.UPHELD, STATUS.REDUCED, STATUS.WAIVED])

export function createClaim({ id, rentalId, limitCents }) {
  return { id, rentalId, limitCents, items: [], charges: [], refunds: [], nextItemNo: 1 }
}

export function newItem(claim, { zone, assetId, rateCode, description, confidence, box, photoIds, preExisting = false, historyRef = null, source = 'claude' }) {
  const no = claim.nextItemNo
  return {
    claim: { ...claim, nextItemNo: no + 1 },
    item: {
      id: `ITEM-${no}`,
      no,
      zone,
      assetId,
      rateCode,
      label: labelOf(rateCode),
      listCents: priceOf(rateCode),
      description,
      confidence,
      box,
      photoIds,
      preExisting,
      historyRef,
      source,
      status: preExisting ? STATUS.DROPPED : STATUS.DRAFT,
      confirmedCents: 0,
      chargedCents: 0,
      refundedCents: 0,
      contest: null,
      staffNote: '',
    },
  }
}

export function addItem(claim, input) {
  const { claim: next, item } = newItem(claim, input)
  return { claim: { ...next, items: [...next.items, item] }, item }
}

function replaceItem(claim, itemId, patch) {
  const index = claim.items.findIndex((i) => i.id === itemId)
  if (index < 0) throw new Error(`Item ${itemId} not found`)
  const updated = { ...claim.items[index], ...patch }
  return { claim: { ...claim, items: claim.items.map((i, n) => (n === index ? updated : i)) }, item: updated }
}

export function getItem(claim, itemId) {
  const item = claim.items.find((i) => i.id === itemId)
  if (!item) throw new Error(`Item ${itemId} not found`)
  return item
}

function expect(item, allowed, action) {
  if (!allowed.includes(item.status)) throw new Error(`Cannot ${action} ${item.id} while it is ${item.status}`)
}

export function staffConfirm(claim, itemId) {
  expect(getItem(claim, itemId), [STATUS.DRAFT], 'confirm')
  return replaceItem(claim, itemId, { status: STATUS.STAFF_OK })
}

export function staffDrop(claim, itemId) {
  expect(getItem(claim, itemId), [STATUS.DRAFT, STATUS.STAFF_OK], 'drop')
  return replaceItem(claim, itemId, { status: STATUS.DROPPED })
}

export function staffMoveBox(claim, itemId, box) {
  expect(getItem(claim, itemId), [STATUS.DRAFT], 'edit the box of')
  return replaceItem(claim, itemId, { box })
}

export function renterAccept(claim, itemId) {
  const item = getItem(claim, itemId)
  expect(item, [STATUS.STAFF_OK], 'accept')
  return replaceItem(claim, itemId, { status: STATUS.ACCEPTED, confirmedCents: item.listCents })
}

export function renterContest(claim, itemId, contest) {
  expect(getItem(claim, itemId), [STATUS.STAFF_OK], 'contest')
  return replaceItem(claim, itemId, { status: STATUS.CONTESTED, contest })
}

// Staff decision on a contested item, or an adjustment of an item that was already charged.
export function staffDecide(claim, itemId, decision, { reducedCents, note = '' } = {}) {
  const item = getItem(claim, itemId)
  if (item.status === STATUS.CHARGED || item.status === STATUS.REFUNDED) {
    if (decision === 'uphold') throw new Error('A charged item cannot be upheld again')
    const target = decision === 'waive' ? 0 : reducedCents
    if (!Number.isInteger(target) || target < 0 || target >= item.chargedCents - item.refundedCents) {
      throw new Error('Reduced amount must be lower than what the renter currently pays for this item')
    }
    return replaceItem(claim, itemId, { confirmedCents: target, staffNote: note })
  }
  expect(item, [STATUS.CONTESTED], 'decide')
  if (decision === 'uphold') return replaceItem(claim, itemId, { status: STATUS.UPHELD, confirmedCents: item.listCents, staffNote: note })
  if (decision === 'waive') return replaceItem(claim, itemId, { status: STATUS.WAIVED, confirmedCents: 0, staffNote: note })
  if (decision === 'reduce') {
    if (!Number.isInteger(reducedCents) || reducedCents <= 0 || reducedCents >= item.listCents) throw new Error('Reduced amount must be between zero and the list price')
    return replaceItem(claim, itemId, { status: STATUS.REDUCED, confirmedCents: reducedCents, staffNote: note })
  }
  throw new Error(`Unknown decision ${decision}`)
}

export const isContestDecided = (item) => DECIDED_AFTER_CONTEST.has(item.status)

export function chargeableCents(item) {
  return PAYABLE.has(item.status) ? item.confirmedCents : 0
}

export function chargeableItems(claim) {
  return claim.items.filter((i) => chargeableCents(i) > 0)
}

export const netPaidCents = (claim) => sum(claim.charges.filter((c) => c.status === 'COMPLETED').map((c) => c.amountCents)) - sum(claim.refunds.filter((r) => r.status === 'COMPLETED').map((r) => r.amountCents))
export const chargedTotal = (claim) => sum(claim.charges.filter((c) => c.status === 'COMPLETED').map((c) => c.amountCents))

// Money still to give back on one charged item after staff lowered what it should cost.
export function refundDueCents(item) {
  if (item.chargedCents === 0) return 0
  return Math.max(0, item.chargedCents - item.refundedCents - item.confirmedCents)
}

export function refundableItems(claim) {
  return claim.items.filter((i) => refundDueCents(i) > 0)
}

export function remainingLimitCents(claim) {
  return Math.max(0, claim.limitCents - (chargedTotal(claim) - sum(claim.refunds.filter((r) => r.status === 'COMPLETED').map((r) => r.amountCents))))
}

export function markCharged(claim, itemIds, charge) {
  let next = { ...claim, charges: [...claim.charges, charge] }
  for (const id of itemIds) {
    const item = getItem(next, id)
    next = replaceItem(next, id, { status: STATUS.CHARGED, chargedCents: chargeableCents(item) }).claim
  }
  return next
}

export function markRefunded(claim, allocations, refund) {
  let next = { ...claim, refunds: [...claim.refunds, refund] }
  for (const { itemId, cents } of allocations) {
    const item = getItem(next, itemId)
    next = replaceItem(next, itemId, { status: STATUS.REFUNDED, refundedCents: item.refundedCents + cents }).claim
  }
  return next
}

// Money invariants (plan 7-5). Throws when the books do not balance.
export function assertInvariants(claim) {
  const net = netPaidCents(claim)
  const chargedItems = claim.items.filter((i) => i.chargedCents > 0)
  const confirmed = sum(chargedItems.map((i) => i.confirmedCents))
  const itemNet = sum(chargedItems.map((i) => i.chargedCents - i.refundedCents))
  if (net < 0 || net > claim.limitCents) throw new Error(`Net paid ${net} is outside 0..${claim.limitCents}`)
  if (itemNet !== net) throw new Error(`Items net ${itemNet} differs from paid net ${net}`)
  const refundsDue = sum(chargedItems.map(refundDueCents))
  if (net - refundsDue !== confirmed) throw new Error(`Net paid ${net} minus pending refunds ${refundsDue} differs from confirmed ${confirmed}`)
  return true
}

export function summarize(claim) {
  const live = claim.items.filter((i) => i.status !== STATUS.DROPPED)
  return {
    keptCents: sum(claim.items.filter((i) => [STATUS.STAFF_OK, STATUS.ACCEPTED, STATUS.CONTESTED, STATUS.UPHELD, STATUS.REDUCED, STATUS.CHARGED].includes(i.status)).map((i) => (i.status === STATUS.CHARGED ? i.confirmedCents : i.status === STATUS.REDUCED ? i.confirmedCents : i.listCents))),
    chargedCents: chargedTotal(claim),
    netCents: netPaidCents(claim),
    openItems: live.length,
    limitCents: claim.limitCents,
    rateCard: RATE_CARD,
  }
}
