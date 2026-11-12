import { useEffect, useRef } from 'react'
import { loadKeys, money, toBase64 } from '../api.js'
import { ApprovalCard } from './ApprovalCard.jsx'
import { ClaudeTrace, runLabel } from './ClaudeTrace.jsx'
import { PickupPanel } from './PickupPanel.jsx'
import { StaffItem } from './ItemCard.jsx'
import { ModelText } from './ModelText.jsx'
import { UploadedPhoto } from './UploadedPhoto.jsx'

const ACTION_LABELS = {
  request_vault_charge: 'request a charge',
  request_refund: 'request a refund',
  request_invoice: 'request an invoice',
  request_token_delete: 'request token delete',
  hold_for_staff: 'hold for staff',
  request_closeup: 'request a close-up',
  summarize_contest: 'review a contest',
}

const loadStaffKey = (sid) => loadKeys(sid)?.staffKey || ''

export function StaffPanel({ state, busy, act, onShowRenter }) {
  const { rental, claim, token, inspection, allowedActions, approvals, lastAgent, agentRuns, activity } = state
  const items = claim.items
  const pendingCloseups = inspection.closeupsRequested.filter((z) => !inspection.closeupsUploaded.includes(z))
  const pendingCards = approvals.filter((a) => a.status === 'pending')
  const otherCards = approvals.filter((a) => a.status !== 'pending').slice().reverse()
  const lastDone = approvals.filter((a) => a.status === 'done').map((a) => a.id).pop()
  const seenDone = useRef(lastDone)
  // After an approval runs, bring its receipt into view: that card is the point of the whole screen.
  useEffect(() => {
    if (lastDone && lastDone !== seenDone.current) document.getElementById(`approval-${lastDone}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    seenDone.current = lastDone
  }, [lastDone])
  async function openEvidence() {
    const res = await fetch(`/api/s/${state.sid}/evidence.html`, { headers: { 'x-staff-key': loadStaffKey(state.sid) } })
    if (res.ok) window.open(URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' })), '_blank')
  }
  const card = (a) => (
    <div key={a.id} id={`approval-${a.id}`}>
      <ApprovalCard approval={a} limitCents={claim.limitCents} items={items} renter={rental.renter?.name} busy={busy}
        onApprove={(id) => act(`/approvals/${id}/approve`, { approver: 'Mina' })}
        onReject={(id) => act(`/approvals/${id}/reject`)} />
    </div>
  )

  return (
    <div>
      {pendingCards.map(card)}

      <section className="card rentsum" aria-label="Rental summary">
        <div className="rentsum__main">
          <div className="eyebrow">Staff: return of {rental.id}</div>
          <h1>{rental.gear.map((g) => g.name).join(' + ')}</h1>
          <p className="muted">Returned Mon 11:30 to {rental.returnedTo}, inspection Tue 09:05. {rental.days} day rental, nothing held for {rental.days} days.</p>
        </div>
        <dl className="facts">
          <div aria-label="Saved PayPal"><dt>Saved PayPal</dt><dd>{token ? <><span className={`st ${token.status === 'active' ? 'st--captured' : 'st--failed'}`}>{token.status}</span> {token.id}</> : 'none, invoice mode'}</dd></div>
          <div><dt>Max damage charge</dt><dd className="num">{money(claim.limitCents)}</dd></div>
          {rental.renter?.name && <div><dt>Renter</dt><dd>{rental.renter.name}</dd></div>}
        </dl>
        <p className="muted rentsum__allowed">Allowed now (computed by code): {allowedActions.map((a) => ACTION_LABELS[a.action]).join(', ') || 'nothing'}</p>
      </section>

      <PickupPanel state={state} busy={busy} act={act} onShowRenter={onShowRenter} />

      <section className="card">
        <div className="row row--between">
          <h2>Claude's zone comparison</h2>
          {!inspection.ran ? <button className="primary" disabled={busy} onClick={() => act('/inspect')}>Run inspection</button> : items.every((i) => i.status === 'draft' || i.status === 'dropped') && <button disabled={busy} onClick={() => act('/inspect')}>Re-run inspection</button>}
        </div>
        <div className="zones">
          {Object.values(inspection.zones).map((z) => (
            <div key={z.zone} className={`zone ${z.verdict === 'damage' ? 'zone--damage' : ''}`}>
              <strong>{z.zone.replaceAll('_', ' ')}</strong><span>{z.verdict}{z.confidence ? `, ${z.confidence}` : ''}</span>
            </div>
          ))}
        </div>
        {pendingCloseups.map((zone) => (
          <p key={zone}>Claude asks for a close-up of {zone.replaceAll('_', ' ')}. <button disabled={busy} onClick={() => act('/closeup', { zone })}>Upload close-up (seeded photo)</button></p>
        ))}
        {inspection.ran && !items.length && <p>No damage found.</p>}
        <p className="muted">Real photos: upload a JPEG or PNG as the check-in photo of a zone. Claude compares it only when the check-out photo of that zone is also a JPEG or PNG. Seeded zones use comparison results written by hand for the drawn demo photos (not model output).</p>
        <div className="row">
          <select aria-label="Zone for the photo" id="photo-zone" defaultValue="top_plate" style={{ width: 'auto' }}>
            {['top_plate', 'body_front', 'rear_lcd', 'lens_mount', 'lens_front', 'lens_barrel'].map((z) => <option key={z} value={z}>{z.replaceAll('_', ' ')}</option>)}
          </select>
          <input aria-label="Photo file" type="file" accept="image/jpeg,image/png" style={{ width: 'auto' }} disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const zone = document.getElementById('photo-zone').value
              await act(`/photos/${zone}`, { kind: 'after', mediaType: file.type, data: await toBase64(file) })
              e.target.value = ''
            }} />
        </div>
        {Object.entries(state.uploads).filter(([k]) => k.startsWith('after:') || k.startsWith('closeup:')).length > 0 && (
          <div className="upload-list" aria-label="Photos you uploaded">
            {Object.entries(state.uploads).filter(([k]) => k.startsWith('after:') || k.startsWith('closeup:')).map(([k, u]) => {
              const [kind, zone] = k.split(':')
              return (
                <figure key={k}>
                  <UploadedPhoto sid={state.sid} kind={kind} zone={zone} version={u.uploadedAt} alt={`Uploaded ${kind} photo, ${zone.replaceAll('_', ' ')}`} />
                  <figcaption>{zone.replaceAll('_', ' ')} · {u.width}x{u.height}</figcaption>
                </figure>
              )
            })}
          </div>
        )}
      </section>

      {items.length > 0 && (
        <section className="card" aria-label="Draft items">
          <div className="card__h"><h2>Draft items</h2><span className="muted">Prices from the rate card, computed by code</span></div>
          {items.map((item) => (
            <StaffItem key={item.id} item={item} busy={busy}
              onConfirm={(id) => act(`/items/${id}/confirm`)}
              onDrop={(id) => act(`/items/${id}/drop`)}
              onBox={(id, box) => act(`/items/${id}/box`, box)}
              onDecide={(id, decision, extra, note) => act(`/items/${id}/decide`, { decision, note, ...extra })} />
          ))}
        </section>
      )}

      {lastAgent?.phase === 'settle' && (
        <section className="card" aria-label="Claude settles">
          <h2>Claude settles</h2>
          <p className="muted">{runLabel(lastAgent, state.modes.llmLabel)}:</p>
          <ModelText text={lastAgent.reply} />
        </section>
      )}

      <ClaudeTrace runs={agentRuns} label={state.modes.llmLabel} />

      {state.holds.length > 0 && <section className="card"><h3>Held for staff</h3><ul>{state.holds.map((h) => <li key={h.at}>{h.reason}</li>)}</ul></section>}

      {otherCards.map(card)}

      {state.claim.charges.some((c) => c.captureId) && (
        <section className="card" aria-label="Dispute watch">
          <div className="row row--between">
            <h2>Dispute watch</h2>
            <div className="row">
              <button disabled={busy} onClick={() => act('/disputes/check')}>Check PayPal disputes</button>
              {state.modes.paypalCalls === 'mock' && <button className="ghost" disabled={busy} onClick={() => act('/disputes/simulate')}>Simulate: renter opens a dispute (mock)</button>}
            </div>
          </div>
          <p className="muted">Read only. Lists open disputes through the Agent Toolkit and keeps those on this rental's captures. Claude has no tool for disputes; the evidence page is what you would send.</p>
          {state.disputeWatch && (
            <div>
              <p>Checked {state.disputeWatch.checkedAt.slice(11, 19)} ({state.disputeWatch.source}), {state.disputeWatch.scanned} open dispute(s) scanned, {state.disputeWatch.found.length} on this rental.</p>
              {state.disputeWatch.found.length > 0 && <ul className="disputes">{state.disputeWatch.found.map((d) => <li key={d.disputeId}><strong>{d.disputeId}</strong> · {d.state} · {d.reason.replaceAll('_', ' ').toLowerCase()} · {d.amount} on order {d.orderId}. {state.closed ? 'Open the readable evidence page below.' : 'Close the rental to build the evidence page.'}</li>)}</ul>}
            </div>
          )}
        </section>
      )}

      {state.linkSent && (
        <section className="card">
          <h2>Close the rental</h2>
          <p className="muted">{token?.kind === 'demo_shared' ? 'Demo token kept for other judges. Deletion runs on tokens you save yourself.' : 'The saved PayPal is deleted through an approval card when everything is settled.'}</p>
          {!state.closed ? <button disabled={busy} onClick={() => act('/close')}>Close rental and build evidence pack</button> : (
            <div>
              <p><button onClick={openEvidence}>Open readable evidence page</button></p>
              <p><span className="badge badge--ok">Closed</span> Evidence pack: {state.evidencePack.photos.length} photos, consent time {state.evidencePack.consentAt.slice(0, 10)}, {state.evidencePack.renterAnswers.length} renter answers, {state.evidencePack.approvers.length} approvals.</p>
            </div>
          )}
        </section>
      )}

      <details className="card"><summary>Activity ({activity.length})</summary>
        <ul className="log">{activity.slice().reverse().map((a, i) => <li key={i}><strong>{a.actor}</strong>: {a.text}</li>)}</ul>
      </details>
    </div>
  )
}
