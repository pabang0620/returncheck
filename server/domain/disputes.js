import { log } from '../demo/sessions.js'
import { HttpError } from '../http.js'
import { toMoney } from './money.js'

const MAX_SCANNED = 20

// Dispute watch (plan 5-4 item 2, 6-3). Read only: lists the merchant's open disputes through the Agent Toolkit
// (`list_disputes`, `get_dispute`) and keeps the ones that sit on a capture this rental made. It never accepts,
// answers or closes a dispute, and Claude has no tool for it. The evidence pack is what staff would send.
export async function checkDisputes(session, gateway) {
  const captures = new Map(session.claim.charges.filter((c) => c.captureId).map((c) => [c.captureId, c]))
  if (!captures.size) throw new HttpError(409, 'Nothing was charged on this rental, so there is nothing to watch.')
  const list = await gateway.listDisputes({ page_size: MAX_SCANNED })
  const summaries = Array.isArray(list?.items) ? list.items.slice(0, MAX_SCANNED) : []
  const found = []
  for (const summary of summaries) {
    const detail = await gateway.getDispute(summary.dispute_id)
    const hit = (detail.disputed_transactions || []).map((t) => t.seller_transaction_id).find((id) => captures.has(id))
    if (!hit) continue
    const charge = captures.get(hit)
    found.push({
      disputeId: detail.dispute_id,
      reason: detail.reason || 'UNKNOWN',
      state: detail.dispute_state || detail.status || 'UNKNOWN',
      amount: detail.dispute_amount ? `${detail.dispute_amount.value} ${detail.dispute_amount.currency_code}` : null,
      captureId: hit,
      orderId: charge.orderId,
      itemIds: charge.itemIds,
      openedAt: detail.create_time || null,
    })
  }
  session.disputeWatch = { checkedAt: new Date().toISOString(), scanned: summaries.length, found, source: gateway.mode === 'mock' ? 'mock' : 'sandbox live' }
  log(session, 'server', found.length ? `Dispute watch: ${found.length} dispute(s) on this rental's charges.` : `Dispute watch: ${summaries.length} open dispute(s) scanned, none on this rental.`)
  return session.disputeWatch
}

// Mock only: a payer opens a dispute on the first captured charge, so the watch has something to show.
export function simulateDispute(session, gateway) {
  if (gateway.mode !== 'mock') throw new HttpError(409, 'Disputes can only be simulated on the mock gateway.')
  const charge = session.claim.charges.find((c) => c.captureId)
  if (!charge) throw new HttpError(409, 'Charge something first.')
  gateway.seedMockDispute({ captureId: charge.captureId, amount: toMoney(charge.amountCents) })
  log(session, 'server', 'Mock: the renter opened a PayPal dispute on a captured charge.')
}
