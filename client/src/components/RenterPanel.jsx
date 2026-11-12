import { useState } from 'react'
import { money } from '../api.js'
import { Crop, PhotoWithBox } from './Evidence.jsx'
import { statusClass } from './ItemCard.jsx'

export function RenterPanel({ state, busy, act, onSaveOwn }) {
  const { rental, claim, token } = state
  const items = claim.items
  return (
    <div className="phone" id="renter-phone" aria-label="Renter phone">
      <div className="phone__title">{rental.id} · {rental.days} days</div>
      <div className="phone__in">
      <section className="pcard">
        <p><strong>Max damage charge: {money(claim.limitCents)}</strong></p>
        <p><strong>No card hold for {rental.days} days.</strong> Return and go. We inspect later.</p>
        <table className="rates" aria-label="Damage rate card"><tbody>{state.rateCard.map((r) => <tr key={r.code}><td>{r.label}</td><td>{money(r.cents)}</td></tr>)}</tbody></table>
        <p className="muted">You see every item with its photos before anything is charged. You can contest each one.</p>
        <p className="muted">PayPal saved for this rental only: {token ? (token.kind === 'demo_shared' ? 'shared sandbox demo PayPal' : 'your own sandbox PayPal') : 'nothing saved (invoice mode)'}{token && ` (${token.status})`}</p>
        {token?.status === 'active' && (
          <div className="row">
            {token.kind === 'demo_shared' && <button disabled={busy} onClick={onSaveOwn}>Save PayPal yourself</button>}
            <button className="ghost link" disabled={busy} onClick={() => act('/token/revoke')}>Simulate: I removed ReturnCheck in PayPal</button>
          </div>
        )}
        {token?.status === 'revoked' && <p className="err">This renter removed ReturnCheck from PayPal. Charging is disabled for this rental. Claude can request an invoice for staff approval.</p>}
      </section>

      {!state.linkSent && <p className="muted">Waiting for the shop to finish the inspection. You will get a link with each item and its photos.</p>}
      {state.linkSent && items.length === 0 && <p>Nothing to pay. Thanks for returning the kit.</p>}
      {state.linkSent && items.map((item) => <RenterItem key={item.id} item={item} busy={busy} act={act} />)}
      {state.linkSent && <Summary claim={claim} />}
      </div>
    </div>
  )
}

// The note the recorded Claude settlement run answered. Any other note works too; it then runs the scripted stand-in.
const EXAMPLE_NOTE = 'This is dust, not a dent'

function RenterItem({ item, busy, act }) {
  const [contesting, setContesting] = useState(false)
  const [note, setNote] = useState('')
  const [photoNote, setPhotoNote] = useState('')
  const after = item.photos.find((p) => p.kind === 'after')
  const before = item.photos.find((p) => p.kind === 'before')
  const answered = item.status !== 'staff_ok'
  return (
    <section className="pcard">
      <div className="row row--between"><strong>{item.no}. {item.zoneLabel}: {item.label.toLowerCase()}</strong><span className="price">{money(item.listCents)}</span></div>
      <div className="pair"><PhotoWithBox url={before.url} caption="Before" /><Crop url={after.url} box={item.box} label="After, zoomed on the mark" /></div>
      <p className="muted">Rate card {item.rateCode}. {item.description}</p>
      {!answered && !contesting && (
        <div className="row">
          <button className="primary" disabled={busy} onClick={() => act(`/items/${item.id}/answer`, { answer: 'accept' })}>Accept</button>
          <button disabled={busy} onClick={() => setContesting(true)}>Contest + photo</button>
        </div>
      )}
      {!answered && contesting && (
        <div>
          <textarea aria-label="Why do you contest" rows={2} placeholder="What do you see differently?" value={note} onChange={(e) => setNote(e.target.value)} />
          <input aria-label="Photo description" placeholder="Attach photo (describe it)" value={photoNote} onChange={(e) => setPhotoNote(e.target.value)} style={{ marginTop: 6 }} />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="primary" disabled={busy || !note.trim()} onClick={() => act(`/items/${item.id}/answer`, { answer: 'contest', note, photoNote })}>Send contest</button>
            {!note && <button className="ghost" onClick={() => setNote(EXAMPLE_NOTE)}>Use example note</button>}
            <button className="ghost" onClick={() => setContesting(false)}>Back</button>
          </div>
        </div>
      )}
      {answered && <RenterStatus item={item} />}
    </section>
  )
}

function RenterStatus({ item }) {
  const text = { accepted: 'You accepted this. Waiting for the charge approval.', contested: 'Contested. A person at the shop will look at your photo.', staff_upheld: 'The shop kept this item after review.', reduced: `Reduced to ${money(item.confirmedCents)} after review.`, waived: 'Waived after review.', charged: `Paid ${money(item.chargedCents)}.`, refunded: `Reduced after review. Refunded ${money(item.refundedCents)}.` }[item.status]
  return <p><span className={statusClass(item.status)}>{item.status.replace('_', ' ')}</span> {text}{item.staffNote && <span className="muted"> Staff note: "{item.staffNote}"</span>}</p>
}

function Summary({ claim }) {
  const charged = claim.charges.filter((c) => c.status === 'COMPLETED' || c.status === 'INVOICED')
  if (!charged.length) return null
  return (
    <section className="pcard">
      <strong>Settled so far</strong>
      {charged.map((c) => <p key={c.requestId || c.orderId} className="muted">{c.status === 'INVOICED' ? `Invoice ${c.orderId} sent to you` : `PayPal order ${c.orderId} · ${money(c.amountCents)}`}</p>)}
      {claim.refunds.map((r) => <p key={r.refundId} className="muted">Refund {r.refundId} · {money(r.amountCents)}</p>)}
      <p>You paid {money(claim.netPaidCents)} in total.</p>
    </section>
  )
}
