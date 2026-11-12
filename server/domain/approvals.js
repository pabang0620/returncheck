import { randomUUID } from 'node:crypto'
import { HttpError } from '../http.js'
import { log } from '../demo/sessions.js'
import { ACTION, computeAllowedActions, describeWhyNot } from './allowedActions.js'
import { assertInvariants, chargeableCents, getItem, markCharged, markRefunded, refundDueCents, STATUS } from './claims.js'
import { assertOwner } from './decisionTable.js'
import { ZONES } from './rateCard.js'
import { withRentalLock } from './locks.js'
import { fromDecimal, sum, toDecimal } from './money.js'

const TYPE_BY_ACTION = {
  [ACTION.CHARGE]: 'vault_charge',
  [ACTION.REFUND]: 'refund',
  [ACTION.INVOICE]: 'invoice',
  [ACTION.TOKEN_DELETE]: 'token_delete',
}
const ACTION_BY_TYPE = Object.fromEntries(Object.entries(TYPE_BY_ACTION).map(([a, t]) => [t, a]))

const itemLine = (item) => ({ name: `${ZONES[item.zone].label} ${item.label.toLowerCase()} (${item.rateCode})`, description: `${item.zone.replaceAll('_', ' ')} / ${item.id}`, sku: item.rateCode, cents: item.status === STATUS.CHARGED ? item.chargedCents : chargeableCents(item) })

// Creates an approval card. This is all a model request can do: no PayPal call, no amount from the caller.
// The amount is recomputed here from the rate card (plan 7-5).
export function requestAction(session, action, { itemIds = [], reason = '', requestedBy = 'claude', requestedVia = null }) {
  assertOwner('amount', 'code')
  const type = TYPE_BY_ACTION[action]
  if (!type) throw new HttpError(400, `Unknown money action ${action}`)
  const allowed = computeAllowedActions(session).find((a) => a.action === action)
  if (!allowed) throw new HttpError(409, describeWhyNot(session, action), { code: 'not_allowed' })

  let chosen = []
  let amountCents = 0
  let allocations = []
  if (action === ACTION.TOKEN_DELETE) {
    chosen = []
  } else {
    chosen = [...new Set(itemIds)]
    if (!chosen.length) throw new HttpError(400, 'Name at least one item.')
    const outside = chosen.filter((id) => !allowed.itemIds.includes(id))
    if (outside.length) throw new HttpError(409, `Items not eligible for this action: ${outside.join(', ')}`, { code: 'items_not_eligible' })
    if (action === ACTION.REFUND) {
      allocations = chosen.map((id) => ({ itemId: id, cents: refundDueCents(getItem(session.claim, id)) }))
      amountCents = sum(allocations.map((a) => a.cents))
    } else {
      amountCents = sum(chosen.map((id) => chargeableCents(getItem(session.claim, id))))
      if (amountCents > allowed.maxCents) throw new HttpError(409, 'Over the consent limit for this rental.', { code: 'over_limit' })
    }
    if (amountCents <= 0) throw new HttpError(409, 'Nothing to move for those items.')
  }

  const approval = {
    id: `APR-${randomUUID().slice(0, 8)}`,
    type,
    status: 'pending',
    requestedBy,
    // Which run asked: { source: 'claude' | 'replay' | 'scripted', label }. Shown on the card.
    requestedVia,
    reason: String(reason).slice(0, 500),
    itemIds: chosen,
    amountCents,
    allocations,
    createdAt: new Date().toISOString(),
    approver: null,
    result: null,
    error: null,
  }
  session.approvals = [...session.approvals, approval]
  log(session, 'claude', `Requested ${type.replace('_', ' ')} for staff approval${amountCents ? ` ($${(amountCents / 100).toFixed(2)} from the rate card)` : ''}. Nothing sent to PayPal.`)
  return approval
}

export function rejectApproval(session, approvalId, approver) {
  const approval = findApproval(session, approvalId)
  if (approval.status !== 'pending') throw new HttpError(409, `Approval is already ${approval.status}.`)
  approval.status = 'rejected'
  approval.approver = approver
  log(session, 'staff', `${approver} rejected ${approval.id}.`)
  return approval
}

function findApproval(session, id) {
  const approval = session.approvals.find((a) => a.id === id)
  if (!approval) throw new HttpError(404, 'Approval not found.')
  return approval
}

function revalidate(session, approval) {
  // Compute the allowed list as if this card were not pending, so its own items are offered again.
  const others = session.approvals
  session.approvals = others.filter((a) => a.id !== approval.id)
  try {
    const allowed = computeAllowedActions(session).find((a) => a.action === ACTION_BY_TYPE[approval.type])
    if (!allowed) return { ok: false, reason: describeWhyNot(session, ACTION_BY_TYPE[approval.type]) }
    if (approval.itemIds.some((id) => !(allowed.itemIds || []).includes(id))) return { ok: false, reason: 'Item states changed since the request.' }
    return { ok: true }
  } finally {
    session.approvals = others
  }
}

// Staff approves: the server takes the rental lock, re-checks the state, then calls PayPal.
// Approving twice runs the money action once because the second call finds the card already done.
export function approve(session, approvalId, approver, gateway) {
  return withRentalLock(session.rental.id, async () => {
    const approval = findApproval(session, approvalId)
    if (approval.status === 'done') return approval
    if (approval.status !== 'pending') throw new HttpError(409, `Approval is ${approval.status}.`)
    assertOwner('approve_money_action', 'human')
    const check = approval.type === 'token_delete' ? { ok: session.token?.kind === 'own' && session.token.status === 'active', reason: 'Token cannot be deleted.' } : revalidate(session, approval)
    const tokenOk = approval.type === 'vault_charge' ? await freshTokenCheck(session, gateway) : true
    if (!check.ok || !tokenOk) {
      approval.status = 'blocked'
      approval.error = tokenOk ? check.reason : 'The renter removed ReturnCheck from PayPal. Charging is disabled for this rental. Claude can request an invoice for staff approval.'
      approval.approver = approver
      log(session, 'server', `Blocked ${approval.id}: ${approval.error}`)
      return approval
    }
    approval.approver = approver
    approval.status = 'executing'
    try {
      assertOwner('execution', 'code')
      approval.result = await execute(session, approval, gateway)
      approval.status = 'done'
      approval.doneAt = new Date().toISOString()
    } catch (err) {
      approval.status = 'failed'
      approval.error = err.message
      log(session, 'server', `PayPal error on ${approval.id}: ${err.message}`)
    }
    return approval
  })
}

async function freshTokenCheck(session, gateway) {
  if (!session.token) return false
  if (session.token.status === 'revoked') return false
  if (session.token.override === 'revoked') { session.token = { ...session.token, status: 'revoked' }; return false }
  const status = await gateway.tokenStatus(session.token.id)
  if (status !== 'active') session.token = { ...session.token, status: 'revoked' }
  return status === 'active'
}

async function execute(session, approval, gateway) {
  const { claim } = session
  const round = claim.charges.length + 1
  if (approval.type === 'vault_charge') return runCharge(session, approval, gateway, round)
  if (approval.type === 'refund') return runRefund(session, approval, gateway)
  if (approval.type === 'invoice') return runInvoice(session, approval, gateway)
  if (approval.type === 'token_delete') return runTokenDelete(session, gateway)
  throw new Error(`Unknown approval type ${approval.type}`)
}

const isNetworkLoss = (err) => !err.status && /network|fetch|ECONN|timeout/i.test(err.message)

async function runCharge(session, approval, gateway, round) {
  const { claim, token } = session
  const items = approval.itemIds.map((id) => getItem(claim, id))
  const invoiceId = round === 1 ? claim.id : `${claim.id}-${round}`
  const requestId = `${claim.id}-r${round}`
  const payload = { vaultId: token.id, invoiceId, requestId, items: items.map(itemLine), amountCents: approval.amountCents }
  let order
  // A lost response is retried with the same Request-Id, so PayPal returns the same order instead of charging twice.
  for (let attempt = 0; ; attempt += 1) {
    try {
      order = await gateway.chargeToken(payload)
      break
    } catch (err) {
      if (!isNetworkLoss(err) || attempt >= 2) throw err
      log(session, 'server', `Response lost, retrying with the same Request-Id ${requestId}.`)
    }
  }
  const unit = order.purchase_units?.[0]
  const capture = unit?.payments?.captures?.[0]
  verifyCharge({ order, unit, capture, approval, invoiceId })
  const charge = { orderId: order.id, captureId: capture.id, status: 'COMPLETED', amountCents: approval.amountCents, itemIds: approval.itemIds, invoiceId, requestId, source: gateway.mode === 'mock' ? 'mock' : 'sandbox live', at: new Date().toISOString() }
  session.claim = markCharged(claim, approval.itemIds, charge)
  assertInvariants(session.claim)
  log(session, 'server', `Charged $${(approval.amountCents / 100).toFixed(2)}: PayPal order ${order.id} ${order.status}.`)
  return { orderId: order.id, status: order.status, captureId: capture.id, invoiceId: unit.invoice_id || invoiceId, requestId, ...receiptFrom(unit, payload.items), source: charge.source }
}

// The order PayPal answered with must match what staff approved. A replayed order for another request
// (same Request-Id or invoice_id) would show a different amount or invoice_id and is rejected here.
function verifyCharge({ order, unit, capture, approval, invoiceId }) {
  if (order.status !== 'COMPLETED') throw new Error(`PayPal order ${order.id} is ${order.status}`)
  if (!capture) throw new Error(`PayPal order ${order.id} has no capture`)
  const expected = toDecimal(approval.amountCents)
  if (unit.amount?.value !== expected) throw new Error(`PayPal order ${order.id} is for ${unit.amount?.value}, approved ${expected}. Not recorded.`)
  if (capture.amount?.value !== expected) throw new Error(`PayPal capture ${capture.id} is for ${capture.amount?.value}, approved ${expected}. Not recorded.`)
  if (unit.invoice_id && unit.invoice_id !== invoiceId) throw new Error(`PayPal order ${order.id} carries invoice_id ${unit.invoice_id}, expected ${invoiceId}. Not recorded.`)
}

// Receipt lines come from the items PayPal returned. Only when the response carries no items do we show the
// request items, and say so.
function receiptFrom(unit, requestItems) {
  const echoed = Array.isArray(unit.items) ? unit.items : []
  if (!echoed.length) return { receiptItems: requestItems, receiptFrom: 'request' }
  return {
    receiptItems: echoed.map((i) => ({ name: i.name, sku: i.sku, cents: fromDecimal(i.unit_amount?.value) * Number(i.quantity || 1) })),
    receiptFrom: 'paypal',
  }
}

async function runRefund(session, approval, gateway) {
  const { claim } = session
  const byCharge = new Map()
  for (const alloc of approval.allocations) {
    const charge = claim.charges.find((c) => c.itemIds.includes(alloc.itemId))
    if (!charge) throw new Error(`No charge found for ${alloc.itemId}`)
    byCharge.set(charge, [...(byCharge.get(charge) || []), alloc])
  }
  const refundIds = []
  for (const [charge, allocs] of byCharge) {
    const cents = sum(allocs.map((a) => a.cents))
    const refund = await gateway.createRefund({ captureId: charge.captureId, amountCents: cents, note: approval.reason || 'Reduced after staff review', invoiceId: charge.invoiceId })
    session.claim = markRefunded(session.claim, allocs, { refundId: refund.id, captureId: charge.captureId, amountCents: cents, status: refund.status === 'COMPLETED' ? 'COMPLETED' : refund.status, itemIds: allocs.map((a) => a.itemId), at: new Date().toISOString() })
    refundIds.push(refund.id)
  }
  assertInvariants(session.claim)
  log(session, 'server', `Refunded $${(approval.amountCents / 100).toFixed(2)} (${refundIds.join(', ')}).`)
  return { refundIds, amountCents: approval.amountCents, captureIds: [...byCharge.keys()].map((c) => c.captureId), source: gateway.mode === 'mock' ? 'mock' : 'sandbox live' }
}

async function runInvoice(session, approval, gateway) {
  const items = approval.itemIds.map((id) => getItem(session.claim, id))
  const invoice = await gateway.createAndSendInvoice({
    invoiceNumber: `${session.claim.id}-INV${session.invoices.length + 1}`,
    recipientEmail: session.rental.renter.email,
    items: items.map(itemLine),
    note: `Damage settlement for rental ${session.rental.id}. Evidence and answers are in your review link.`,
  })
  session.invoices = [...session.invoices, { ...invoice, amountCents: approval.amountCents, itemIds: approval.itemIds }]
  // An invoice is not paid yet: the items stay open and are marked as invoiced through the approval record only.
  const charge = { orderId: invoice.invoiceId, captureId: null, status: 'INVOICED', amountCents: 0, itemIds: approval.itemIds, invoiceId: invoice.invoiceId, requestId: null, source: gateway.mode === 'mock' ? 'mock' : 'sandbox live', at: new Date().toISOString() }
  session.claim = { ...session.claim, charges: [...session.claim.charges, charge] }
  log(session, 'server', `Invoice ${invoice.invoiceId} sent to ${session.rental.renter.email}.`)
  return { invoiceId: invoice.invoiceId, status: invoice.status, amountCents: approval.amountCents }
}

async function runTokenDelete(session, gateway) {
  const token = session.token
  if (!token || token.kind !== 'own') throw new HttpError(409, 'Demo token kept for other judges. Deletion runs on tokens you save yourself.')
  const res = await gateway.deleteToken(token.id)
  session.token = { ...token, status: 'deleted', deletedAt: new Date().toISOString() }
  log(session, 'server', `Saved PayPal ${token.id} deleted (HTTP ${res.http_status}).`)
  return { tokenId: token.id, httpStatus: res.http_status }
}
