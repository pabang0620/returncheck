// Plan section 7-1 and 7-4 as code: who decides what. Tools and services call `assertOwner`
// so the table is enforced where the decision is made, not only documented.
export const OWNER = Object.freeze({ CODE: 'code', MODEL: 'model', HUMAN: 'human' })

export const DECISIONS = Object.freeze([
  { id: 'allowed_actions', owner: OWNER.CODE, text: 'Which PayPal actions are possible now (token state, order state, item state, limit)' },
  { id: 'amount', owner: OWNER.CODE, text: 'Every amount: rate card sum, limit check, refund = charged minus confirmed' },
  { id: 'token_branch', owner: OWNER.CODE, text: 'Token active means charge, token revoked means invoice request only' },
  { id: 'refund_branch', owner: OWNER.CODE, text: 'Charged item reduced after the charge means request_refund is offered' },
  { id: 'idempotency', owner: OWNER.CODE, text: 'Request-Id, rental lock, duplicate approval and duplicate charge guards' },
  { id: 'damage_this_rental', owner: OWNER.MODEL, text: 'Is this mark new in this rental: compare photos and past returns of the same asset' },
  { id: 'ambiguous_zone', owner: OWNER.MODEL, text: 'Ask for a close-up, hold the verdict, or draft an item' },
  { id: 'charge_vs_hold', owner: OWNER.MODEL, text: 'Which accepted items to request now and which contested ones go to staff, judged from the renter note and photo against the original evidence' },
  { id: 'refund_reason', owner: OWNER.MODEL, text: 'Plain-language reason sentence for a refund request (never the amount)' },
  { id: 'item_confirm', owner: OWNER.HUMAN, text: 'Staff confirms or drops each drafted item' },
  { id: 'renter_answer', owner: OWNER.HUMAN, text: 'Renter accepts or contests each item' },
  { id: 'contest_decision', owner: OWNER.HUMAN, text: 'Staff upholds, reduces or waives a contested item' },
  { id: 'approve_money_action', owner: OWNER.HUMAN, text: 'Staff approves a charge, refund, invoice or token deletion card' },
  { id: 'execution', owner: OWNER.CODE, text: 'After approval the server calls PayPal; the model never does' },
])

const byId = new Map(DECISIONS.map((d) => [d.id, d]))

export function ownerOf(decisionId) {
  const row = byId.get(decisionId)
  if (!row) throw new Error(`Unknown decision ${decisionId}`)
  return row.owner
}

export function assertOwner(decisionId, actor) {
  if (ownerOf(decisionId) !== actor) {
    throw new Error(`Decision "${decisionId}" belongs to ${ownerOf(decisionId)}, not ${actor}`)
  }
}

export function decisionsOwnedBy(owner) {
  return DECISIONS.filter((d) => d.owner === owner)
}
