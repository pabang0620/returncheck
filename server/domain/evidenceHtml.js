import { toDecimal } from './money.js'

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// One printable page for a closed rental: who agreed to what, each item and answer, who approved, what PayPal did.
export function renderEvidenceHtml(session) {
  const { rental, claim } = session
  const pack = session.evidencePack
  const rows = claim.items.map((i) => `<tr><td>${esc(i.id)}</td><td>${esc(i.zone)}</td><td>${esc(i.rateCode)}</td><td>$${toDecimal(i.listCents)}</td><td>${esc(i.status)}</td><td>${esc(i.contest?.note || '')}</td><td>${esc(i.staffNote || '')}</td></tr>`).join('')
  const approvals = (pack?.approvers || []).map((a) => `<li>${esc(a.approval)}: ${esc(a.type)} ${esc(a.status)} by ${esc(a.approver)}</li>`).join('')
  const charges = claim.charges.map((c) => `<li>${esc(c.status)} ${esc(c.orderId)} $${toDecimal(c.amountCents)} (invoice_id ${esc(c.invoiceId || '')})</li>`).join('')
  const refunds = claim.refunds.map((r) => `<li>Refund ${esc(r.refundId)} $${toDecimal(r.amountCents)}</li>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Evidence ${esc(rental.id)}</title><style>body{font:15px/1.45 system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#1F2328}table{border-collapse:collapse;width:100%}td,th{border:1px solid #DDD8CC;padding:6px 8px;text-align:left;font-size:13px}h1{font-size:22px}</style></head><body>`
    + `<h1>Evidence for rental ${esc(rental.id)}</h1><p>Consent recorded ${esc(pack?.consentAt || rental.pickupAt)}. Consent limit $${toDecimal(claim.limitCents)}. Photos, dates and history in this demo are seeded.</p>`
    + `<h2>Items and answers</h2><table><thead><tr><th>Item</th><th>Zone</th><th>Rate code</th><th>List</th><th>State</th><th>Renter note</th><th>Staff note</th></tr></thead><tbody>${rows}</tbody></table>`
    + `<h2>Approvals</h2><ul>${approvals || '<li>none</li>'}</ul><h2>PayPal</h2><ul>${charges}${refunds}</ul><p>Net paid $${toDecimal(Math.max(0, claim.charges.filter((c) => c.status === 'COMPLETED').reduce((t, c) => t + c.amountCents, 0) - claim.refunds.reduce((t, r) => t + r.amountCents, 0)))}.</p></body></html>`
}
