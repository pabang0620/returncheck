import { useState } from 'react'
import { money } from '../api.js'

const TITLES = {
  vault_charge: 'charge the renter\'s saved PayPal',
  refund: 'refund part of a charge',
  invoice: 'send a PayPal invoice',
  token_delete: 'delete the saved PayPal for this rental',
}

// Where the server took the amount from. The model never passes an amount.
const AMOUNT_BASIS = {
  vault_charge: 'server, rate card',
  invoice: 'server, rate card',
  refund: 'server, charged minus confirmed',
}

const sourceChip = (source) => <span className="chip chip--live">{source === 'mock' ? 'mock PayPal' : 'PayPal sandbox live'}</span>

const STATE_TAG = {
  pending: ['pending', 'Pending approval'],
  done: ['captured', 'Done'],
  failed: ['failed', 'PayPal refused'],
  blocked: ['failed', 'Blocked'],
  rejected: ['refunded', 'Rejected'],
}
const APPROVE_LABEL = { vault_charge: 'charge', refund: 'refund', invoice: 'invoice', token_delete: 'delete' }
const IN_THIS = { vault_charge: 'in this charge', refund: 'in this refund', invoice: 'in this invoice' }

// Line of each claim item on the card: what this card moves, what is held, what is not billed.
function lineState(item, approval) {
  if (approval.itemIds.includes(item.id)) return ['st st--pending', IN_THIS[approval.type] || 'in this card']
  if (item.status === 'contested') return ['st st--held', 'held for staff']
  if (item.status === 'dropped' || item.status === 'waived') return ['tag', item.status === 'dropped' ? 'not billed' : 'waived']
  if (item.status === 'charged' || item.status === 'refunded') return ['st st--captured', item.status]
  return ['tag', item.status.replace('_', ' ')]
}

export function ApprovalCard({ approval, limitCents, items = [], renter, onApprove, onReject, busy }) {
  const [approver] = useState('Mina')
  const pending = approval.status === 'pending'
  const [tone, tag] = STATE_TAG[approval.status] || ['pending', approval.status]
  const scripted = approval.requestedVia?.source === 'scripted'
  const accepted = approval.itemIds.filter((id) => items.find((i) => i.id === id)?.status === 'accepted')
  const pct = limitCents ? Math.min(100, (approval.amountCents / limitCents) * 100) : 0
  const lines = items.filter((i) => i.status !== 'draft')
  return (
    <section className={`card approval ${pending ? 'approval--pending' : ''}`} aria-label="Approval card">
      <div className="approval__top"><span className={`st st--${tone}`}>{tag}</span><span className="muted">{approval.id}</span></div>
      <h1 className="approval__lead">{scripted ? 'Requested by the rule-based stand-in' : 'Requested by Claude'}: {TITLES[approval.type]}</h1>
      {approval.reason && <p>Reason: {approval.reason}</p>}
      {approval.amountCents > 0 && (
        <div className="amount">
          <div><span className="muted">Amount ({AMOUNT_BASIS[approval.type] || 'server'})</span><b className="num amount__big price">{money(approval.amountCents)}</b></div>
          <div className="amount__limit"><span className="muted">Limit</span><b className="num">{money(limitCents)}</b><div className="bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div></div>
        </div>
      )}
      {pending && lines.length > 0 && approval.type !== 'token_delete' && (
        <table className="lines">
          <thead><tr><th>Item</th><th>State</th><th className="r">Amount</th></tr></thead>
          <tbody>{lines.map((i) => {
            const [cls, text] = lineState(i, approval)
            const inCard = approval.itemIds.includes(i.id)
            const cents = inCard && approval.type === 'refund' ? (approval.allocations?.find((x) => x.itemId === i.id)?.cents ?? 0) : i.status === 'dropped' ? 0 : i.chargeableCents || i.listCents
            return <tr key={i.id}><td>{i.id} {i.zoneLabel} {i.label.toLowerCase()} <code>{i.rateCode}</code></td><td><span className={cls}>{text}</span></td><td className={`r num ${inCard ? '' : 'muted'}`}>{money(cents)}</td></tr>
          })}</tbody>
        </table>
      )}
      {!pending && approval.itemIds.length > 0 && <p className="muted">Items: {approval.itemIds.join(', ')}</p>}
      {pending && (
        <div className="who">
          <div><span className="muted">Requested by</span><b>{scripted ? 'Rule-based stand-in' : 'Claude'}</b><em>{approval.requestedVia?.label || 'agent tool call'}</em></div>
          {approval.type === 'vault_charge' && <div><span className="muted">Agreed by renter</span><b>{renter || 'Renter'}</b><em>{accepted.length ? `accepted ${accepted.join(', ')} from the link` : 'did not accept; staff decided'}</em></div>}
          <div><span className="muted">Approver</span><b>{approver}</b><em>counter staff, you</em></div>
        </div>
      )}
      {pending && (
        <>
          <p className="gate"><strong>Not executed until approved.</strong> Nothing has been sent to PayPal.</p>
          <div className="actions">
            <button className="primary big" disabled={busy} onClick={() => onApprove(approval.id)}>Approve {approval.amountCents > 0 ? `${money(approval.amountCents)} ` : ''}{APPROVE_LABEL[approval.type]}</button>
            <button disabled={busy} onClick={() => onReject(approval.id)}>Reject</button>
          </div>
        </>
      )}
      {approval.status === 'blocked' && <p className="err">Blocked: {approval.error}</p>}
      {approval.status === 'failed' && <p className="err">PayPal error: {approval.error}. Retrying uses the same Request-Id, so nothing is charged twice.</p>}
      {approval.status === 'rejected' && <p className="muted">Rejected by {approval.approver}.</p>}
      {approval.status === 'done' && <Receipt approval={approval} />}
    </section>
  )
}

function Receipt({ approval }) {
  const r = approval.result
  if (approval.type === 'vault_charge') {
    return (
      <div className="receipt">
        <p><strong>PayPal order {r.orderId}</strong> <span className="badge badge--ok">{r.status}</span> {sourceChip(r.source)}</p>
        <p className="muted">invoice_id {r.invoiceId} · Request-Id {r.requestId} · capture {r.captureId}</p>
        <p>{r.receiptFrom === 'paypal' ? 'Items PayPal returned for this order:' : 'Items sent in the order (PayPal did not echo them back):'}</p>
        <table className="lines"><tbody>{r.receiptItems.map((i) => <tr key={i.sku}><td>{i.name}</td><td className="r num">{money(i.cents)}</td></tr>)}</tbody></table>
      </div>
    )
  }
  if (approval.type === 'refund') return <p>Refund <strong>{r.refundIds.join(', ')}</strong> for {money(r.amountCents)} completed{r.captureIds?.length ? ` on capture ${r.captureIds.join(', ')}` : ''}. {r.source && sourceChip(r.source)}</p>
  if (approval.type === 'invoice') return <p>Invoice <strong>{r.invoiceId}</strong> {r.status} for {money(r.amountCents)}. The renter pays it in PayPal.</p>
  return <p>Saved PayPal {r.tokenId} deleted. PayPal answered HTTP {r.httpStatus}.</p>
}
