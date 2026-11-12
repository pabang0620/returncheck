import { useState } from 'react'
import { money } from '../api.js'
import { BeforeAfter, Crop } from './Evidence.jsx'

const STATUS_TEXT = {
  draft: 'Draft by Claude',
  staff_ok: 'Kept, waiting for renter',
  accepted: 'Renter accepted',
  contested: 'Renter contested',
  staff_upheld: 'Upheld by staff',
  reduced: 'Reduced by staff',
  waived: 'Waived by staff',
  charged: 'Charged',
  refunded: 'Refunded in part',
  dropped: 'Not billed',
}

// Money-state colour of each item status (theme.css .st--*). Draft and closed-out lines stay neutral.
export const STATUS_TONE = {
  staff_ok: 'pending', accepted: 'captured', contested: 'held', staff_upheld: 'pending', reduced: 'pending', charged: 'captured', refunded: 'refunded',
}
export const statusClass = (status) => (STATUS_TONE[status] ? `st st--${STATUS_TONE[status]}` : 'tag')

export function StaffItem({ item, busy, onConfirm, onDrop, onBox, onDecide }) {
  const [note, setNote] = useState('')
  const after = item.photos.find((p) => p.kind === 'after')
  const closeup = item.photos.find((p) => p.kind === 'closeup')
  const canAdjust = item.status === 'contested' || item.status === 'charged' || item.status === 'refunded'
  const half = Math.round(item.listCents / 2)
  return (
    <div className={`item ${item.status === 'dropped' ? 'item--dropped' : ''}`} aria-label={`Claim item ${item.no}`}>
      <div className="item__thumbs">
        {item.preExisting && item.history ? (
          <div className="pair">
            <figure><img className="crop" src={item.history.url} alt="Earlier return photo" /><figcaption>Return of {item.history.rentalId} ({item.history.returnedAt.slice(0, 10)}): mark already there. Not billed.</figcaption></figure>
            <figure><img className="crop" src={after.url} alt="This return" /><figcaption>This return</figcaption></figure>
          </div>
        ) : (
          <BeforeAfter item={item} onBoxChange={item.status === 'draft' ? (box) => onBox(item.id, box) : undefined} />
        )}
        {closeup && <figure><img className="crop" src={closeup.url} alt="Close-up" /><figcaption>Close-up uploaded</figcaption></figure>}
      </div>
      <div className="item__body">
      <div className="item__row">
        <h3>{item.no}. {item.zoneLabel}: {item.label.toLowerCase()}</h3>
        <span className={`price ${item.status === 'dropped' ? 'price--off' : ''}`}>{money(item.listCents)} <code>{item.rateCode}</code></span>
      </div>
      <p className="muted">{item.description}</p>
      <div className="item__tags"><span className={statusClass(item.status)}>{STATUS_TEXT[item.status]}</span><span className="muted">confidence {item.confidence}</span></div>
      {item.status === 'draft' && (
        <div className="row">
          <button className="primary" disabled={busy} onClick={() => onConfirm(item.id)}>Keep</button>
          <button disabled={busy} onClick={() => onDrop(item.id)}>Drop</button>
        </div>
      )}
      {item.contest && (
        <div className="subcard">
          <strong>Renter contest</strong>
          <p className="quote">Renter: "{item.contest.note || 'No note'}"{item.contest.photoNote && <span className="muted"> (photo: {item.contest.photoNote})</span>}</p>
          <div className="pair"><Crop url={after.url} box={item.box} label="Evidence crop" /><div className="muted">Compare the crop with what the renter says. A person decides.</div></div>
        </div>
      )}
      {canAdjust && item.status !== 'refunded' && (
        <div className="subcard">
          <input aria-label="Staff note" placeholder="Note for the renter, plain words" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            {item.status === 'contested' && <button disabled={busy} onClick={() => onDecide(item.id, 'uphold', {}, note)}>Uphold {money(item.listCents)}</button>}
            <button disabled={busy} onClick={() => onDecide(item.id, 'reduce', { reducedCents: half }, note)}>Reduce to {money(half)}</button>
            <button disabled={busy} onClick={() => onDecide(item.id, 'waive', {}, note)}>Waive</button>
          </div>
        </div>
      )}
      {item.staffNote && <p className="muted">Staff note: {item.staffNote}</p>}
      {item.refundDueCents > 0 && <p className="err">Charged {money(item.chargedCents)} but now due {money(item.confirmedCents)}. A refund of {money(item.refundDueCents)} can be requested.</p>}
      </div>
    </div>
  )
}
