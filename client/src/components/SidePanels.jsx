import { money } from '../api.js'

// The right column of the staff screen: one summary panel that always says what is owed and what to press,
// what PayPal will do for the card waiting on staff, and every money state of this rental. Presentation only:
// every number here comes from the staff state the server sends.

const LIVE = new Set(['staff_ok', 'accepted', 'contested', 'staff_upheld', 'reduced', 'charged'])

export function SettlePanel({ state, busy, error, act }) {
  const { claim, inspection, approvals } = state
  const items = claim.items
  const drafts = items.filter((i) => i.status === 'draft')
  const pending = approvals.filter((a) => a.status === 'pending')
  const contested = items.some((i) => i.status === 'contested')
  let action = null
  let hint = ''
  if (state.closed) {
    hint = 'Rental closed. The evidence pack is built.'
  } else if (!state.linkSent) {
    if (items.length) action = { label: 'Send link', path: '/link', disabled: drafts.length > 0 }
    hint = !inspection.ran ? 'Run the inspection first.' : !items.length ? 'No damage found. Nothing to send.' : drafts.length ? 'Keep or drop each draft first.' : 'The renter gets every item with its photos on their phone.'
  } else {
    action = { label: 'Ask Claude to settle', path: '/agent/settle', disabled: !state.settleNeeded }
    if (!state.settleNeeded) hint = `Nothing for Claude to request right now. ${pending.length ? 'Approve or reject the waiting card first.' : items.some((i) => i.status === 'staff_ok') ? 'Waiting for the renter to answer each item in the phone.' : contested ? 'Decide the held item in Draft items (Uphold, Reduce or Waive), then ask again.' : 'Reduce an item, or close the rental.'}`
    else if (contested) hint = 'There is a contested item. Claude holds it for you; decide it in Draft items.'
  }
  return (
    <section className="card settle" aria-label="Settle">
      <div className="settle__sum">
        <span className="muted">Total kept</span>
        <b className="num">{money(claim.summary.keptCents)}</b>
        <span className="muted">of {money(claim.limitCents)} limit{claim.netPaidCents > 0 ? ` · paid so far ${money(claim.netPaidCents)}` : ''}</span>
      </div>
      <p className="settle__txt">Claude can only request. Nothing reaches PayPal until staff press Approve.</p>
      {action && <button className="primary settle__go" disabled={busy || action.disabled} onClick={() => act(action.path)}>{action.label}</button>}
      {hint && <p className="muted settle__hint">{hint}</p>}
      {error && <p className="err" role="alert">{error}</p>}
    </section>
  )
}

const itemLine = (item) => `${item.zoneLabel} ${item.label.toLowerCase()} (${item.rateCode})`

// What happens at PayPal when staff press Approve on the oldest waiting card.
export function PayPalPlan({ state }) {
  const approval = state.approvals.find((a) => a.status === 'pending')
  if (!approval) return null
  const { rental, claim } = state
  const items = approval.itemIds.map((id) => claim.items.find((i) => i.id === id)).filter(Boolean)
  const steps = {
    vault_charge: [
      `Create an order on the saved PayPal of ${rental.id} (Vault v3, payer not present).`,
      <>Capture <b className="num">{money(approval.amountCents)} USD</b>, {items.length === 1 ? 'one line' : `${items.length} lines`}: {items.map(itemLine).join(', ')}.</>,
      'The server checks PayPal\'s answer: amount, capture and invoice_id must match what Mina approved.',
    ],
    refund: [
      <>Refund <b className="num">{money(approval.amountCents)} USD</b> on the capture of this rental's charge.</>,
      `Items: ${items.map(itemLine).join(', ')}.`,
      'The server records the refund id PayPal returns.',
    ],
    invoice: [
      'Create a PayPal invoice through the Agent Toolkit and send it to the renter.',
      <>Amount <b className="num">{money(approval.amountCents)} USD</b> from the rate card.</>,
      'The renter pays it in PayPal; nothing is charged to a saved PayPal.',
    ],
    token_delete: [
      `Delete the PayPal saved for ${rental.id} (Vault v3).`,
      'Nothing is charged or refunded.',
    ],
  }[approval.type] || []
  return (
    <section className="card" aria-label="What PayPal will do">
      <h2>What PayPal will do on Approve</h2>
      <ol className="ppsteps">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <dl className="ids">
        <div><dt>Card</dt><dd><code>{approval.id}</code></dd></div>
        <div><dt>Claim</dt><dd><code>{claim.id}</code></dd></div>
        {approval.type === 'vault_charge' && <div><dt>invoice_id, Request-Id</dt><dd>built from the claim id</dd></div>}
        {approval.type === 'vault_charge' && <div><dt>Retry</dt><dd>Same Request-Id, never charged twice</dd></div>}
      </dl>
    </section>
  )
}

// Every money state on this rental, newest last. Kinds that have not happened yet show as a faded line that
// says when they would.
export function MoneyLedger({ state }) {
  const { claim, token, approvals } = state
  const rows = []
  if (token) rows.push({ st: token.status === 'active' ? 'captured' : 'failed', tag: token.status === 'active' ? 'saved' : token.status, text: token.status === 'active' ? 'PayPal saved at pickup, no hold' : 'Saved PayPal removed by the renter', cents: 0 })
  else rows.push({ st: 'held', tag: 'invoice', text: 'Nothing saved, invoice mode', cents: 0 })
  for (const a of approvals.filter((x) => x.status === 'pending')) {
    const kind = { vault_charge: 'charge', refund: 'refund', invoice: 'invoice', token_delete: 'saved PayPal delete' }[a.type]
    rows.push({ st: 'pending', tag: 'pending', text: `${a.itemIds.length ? `${a.itemIds.join(', ')} ` : ''}${kind}, waiting for Mina`, cents: a.amountCents })
  }
  for (const i of claim.items.filter((x) => x.status === 'contested')) rows.push({ st: 'held', tag: 'held', text: `${i.id} contested, held for staff`, cents: i.listCents })
  for (const c of claim.charges) rows.push({ st: 'captured', tag: c.status === 'INVOICED' ? 'invoiced' : 'captured', text: c.status === 'INVOICED' ? `Invoice ${c.orderId} sent` : `Order ${c.orderId}${c.captureId ? `, capture ${c.captureId}` : ''}`, cents: c.amountCents })
  for (const r of claim.refunds) rows.push({ st: 'refunded', tag: 'refunded', text: `Refund ${r.refundId}`, cents: r.amountCents })
  for (const a of approvals.filter((x) => x.status === 'failed' || x.status === 'blocked')) rows.push({ st: 'failed', tag: a.status, text: a.error || 'PayPal refused', cents: a.amountCents })
  const failed = approvals.some((x) => x.status === 'failed' || x.status === 'blocked')
  const ghosts = [
    !claim.charges.length ? { st: 'captured', tag: 'captured', text: 'After Approve: order and capture id appear here' } : null,
    !claim.refunds.length ? { st: 'refunded', tag: 'refunded', text: 'If you reduce an item later, Claude requests a refund' } : null,
    !failed ? { st: 'failed', tag: 'failed', text: 'If PayPal refuses, the card says why and nothing is recorded' } : null,
  ].filter(Boolean)
  const open = claim.items.filter((i) => LIVE.has(i.status)).length
  return (
    <section className="card" aria-label="Money on this rental">
      <div className="card__h"><h2>Money on this rental</h2><span className="muted">{open} open item{open === 1 ? '' : 's'}</span></div>
      <ul className="ledger">
        {rows.map((r, i) => <li key={`r${i}`}><span className={`st st--${r.st}`}>{r.tag}</span><span>{r.text}</span><b className="num">{money(r.cents || 0)}</b></li>)}
        {ghosts.map((r) => <li key={`g${r.tag}`} className="is-ghost"><span className={`st st--${r.st}`}>{r.tag}</span><span>{r.text}</span><b className="num">-</b></li>)}
      </ul>
    </section>
  )
}

// Where the rental is, worked out from its state: pickup and return are seeded, the rest follows the claim.
export function Steps({ state }) {
  const { claim, inspection, approvals } = state
  const answered = state.linkSent && !claim.items.some((i) => i.status === 'staff_ok')
  const pending = approvals.some((a) => a.status === 'pending')
  const paid = claim.charges.length > 0
  const done = [true, true, inspection.ran && state.linkSent, answered, answered && !pending && (paid || state.closed), paid || state.closed]
  const now = done.indexOf(false)
  const labels = ['Pickup', 'Return', 'Inspect', 'Renter answers', 'Staff approves', 'PayPal charge']
  return (
    <ol className="steps" aria-label="Rental progress">
      {labels.map((l, i) => (
        <li key={l} className={done[i] ? 'is-done' : i === now ? 'is-now' : ''} aria-current={i === now ? 'step' : undefined}>
          <span className="steps__n">{i + 1}</span>{l}
        </li>
      ))}
    </ol>
  )
}
