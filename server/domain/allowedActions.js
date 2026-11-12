import { STATUS, chargeableCents, chargeableItems, refundableItems, refundDueCents, remainingLimitCents } from './claims.js'
import { sum } from './money.js'

const MAX_CLOSEUPS = 2

export const ACTION = Object.freeze({
  CHARGE: 'request_vault_charge',
  REFUND: 'request_refund',
  INVOICE: 'request_invoice',
  TOKEN_DELETE: 'request_token_delete',
  HOLD: 'hold_for_staff',
  CLOSEUP: 'request_closeup',
  SUMMARIZE: 'summarize_contest',
})

// Items already named by a pending approval are not offered again.
function pendingItemIds(session, type) {
  return new Set(session.approvals.filter((a) => a.status === 'pending' && a.type === type).flatMap((a) => a.itemIds))
}

function pendingChargeCents(session) {
  return sum(session.approvals.filter((a) => a.status === 'pending' && (a.type === 'vault_charge' || a.type === 'invoice')).map((a) => a.amountCents))
}

// The code decides what PayPal actions exist right now (plan 7-1). The model only picks among these.
export function computeAllowedActions(session) {
  const { claim, token, rental } = session
  const actions = []
  const tokenActive = Boolean(token && token.status === 'active')
  const inInvoiceMode = rental.mode === 'invoice' || (token && token.status === 'revoked')
  const invoicedIds = new Set(claim.charges.filter((c) => c.status === 'INVOICED').flatMap((c) => c.itemIds))
  const room = remainingLimitCents(claim) - pendingChargeCents(session) - sum(session.invoices.map((i) => i.amountCents))

  if (session.inspection.ran) actions.push({ action: ACTION.HOLD })
  const contested = claim.items.filter((i) => i.status === STATUS.CONTESTED)
  if (contested.length) actions.push({ action: ACTION.SUMMARIZE, itemIds: contested.map((i) => i.id) })

  const uncertain = Object.values(session.inspection.zones).filter((z) => z.verdict === 'uncertain' && !session.inspection.closeupsRequested.includes(z.zone))
  if (uncertain.length && session.inspection.closeupsRequested.length < MAX_CLOSEUPS) {
    actions.push({ action: ACTION.CLOSEUP, zones: uncertain.map((z) => z.zone), remaining: MAX_CLOSEUPS - session.inspection.closeupsRequested.length })
  }

  const payable = chargeableItems(claim).filter((i) => i.status !== STATUS.CHARGED && !invoicedIds.has(i.id))
  const pendingCharge = pendingItemIds(session, 'vault_charge')
  const pendingInvoice = pendingItemIds(session, 'invoice')
  const sendable = (blocked) => payable.filter((i) => !blocked.has(i.id) && chargeableCents(i) > 0)

  if (tokenActive && !inInvoiceMode) {
    const items = sendable(pendingCharge)
    const total = sum(items.map(chargeableCents))
    if (items.length && total <= room) actions.push({ action: ACTION.CHARGE, itemIds: items.map((i) => i.id), maxCents: room })
  } else if (inInvoiceMode) {
    const items = sendable(pendingInvoice)
    const total = sum(items.map(chargeableCents))
    if (items.length && total <= room) actions.push({ action: ACTION.INVOICE, itemIds: items.map((i) => i.id), maxCents: room })
  }

  const pendingRefund = pendingItemIds(session, 'refund')
  const refundable = refundableItems(claim).filter((i) => !pendingRefund.has(i.id))
  if (refundable.length && session.claim.charges.length) actions.push({ action: ACTION.REFUND, itemIds: refundable.map((i) => i.id), dueCents: sum(refundable.map(refundDueCents)) })

  const unsettled = claim.items.some((i) => [STATUS.DRAFT, STATUS.STAFF_OK, STATUS.CONTESTED].includes(i.status) || (chargeableCents(i) > 0 && i.status !== STATUS.CHARGED))
  const hasPendingMoney = session.approvals.some((a) => a.status === 'pending')
  if (token && token.status === 'active' && token.kind === 'own' && !unsettled && !hasPendingMoney && session.inspection.ran) {
    actions.push({ action: ACTION.TOKEN_DELETE, tokenId: token.id })
  }
  return actions
}

export function isAllowed(session, action) {
  return computeAllowedActions(session).find((a) => a.action === action) || null
}

export function describeWhyNot(session, action) {
  const { token } = session
  if (action === ACTION.CHARGE && token && token.status !== 'active') return 'The saved PayPal token is not active, so a charge cannot be requested. Request an invoice instead.'
  if (action === ACTION.CHARGE && !token) return 'No PayPal is saved for this rental. Request an invoice instead.'
  if (action === ACTION.INVOICE && token && token.status === 'active' && session.rental.mode !== 'invoice') return 'The saved PayPal token is active, so an invoice request is not offered.'
  if (action === ACTION.TOKEN_DELETE && token?.kind === 'demo_shared') return 'Demo token kept for other judges. Deletion runs on tokens you save yourself.'
  return `Action ${action} is not allowed in the current state of this rental.`
}
