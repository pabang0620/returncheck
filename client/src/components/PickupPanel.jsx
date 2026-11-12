import { money, toBase64 } from '../api.js'
import { UploadedPhoto } from './UploadedPhoto.jsx'

const stamp = (iso) => `Mon ${iso.slice(11, 16)}`

// Screen A, Monday pickup on the counter tablet. The six check-out photos come from the seed; a real JPEG or PNG
// can replace one. Below it, the step the renter does on their own phone: see the limit and save PayPal.
export function PickupPanel({ state, busy, act, onShowRenter }) {
  const { pickup, rental, claim, token, uploads } = state
  const done = pickup.zones.length
  return (
    <details className="card pickup">
      <summary>
        <strong>Monday pickup</strong>
        <span className="muted"> · {rental.gear.map((g) => g.name).join(' + ')} · {rental.id} · {done}/{done} zones photographed · nothing held for {rental.days} days</span>
      </summary>
      <div className="pickup__grid">
        {pickup.zones.map((z) => (
          <figure key={z.zone} className="pickup__zone">
            {z.url ? <img src={z.url} alt={`Check-out photo, ${z.label}`} /> : <UploadedPhoto sid={state.sid} kind="before" zone={z.zone} version={uploads[`before:${z.zone}`]?.uploadedAt} alt={`Uploaded check-out photo, ${z.label}`} />}
            <figcaption>
              <strong>{z.label}</strong>
              <span className="muted">{z.asset} · {stamp(z.capturedAt)} · {z.source}</span>
              <label className="link">
                Retake with a file
                <input type="file" accept="image/jpeg,image/png" hidden disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    await act(`/photos/${z.zone}`, { kind: 'before', mediaType: file.type, data: await toBase64(file) })
                    e.target.value = ''
                  }} />
              </label>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="pickup__consent">
        <div>
          <strong>Renter step (on their phone)</strong>
          <p className="muted">Max damage charge {money(claim.limitCents)}. The renter sees the rate card, then saves PayPal for this rental only. PayPal: {token ? `${token.kind === 'demo_shared' ? 'shared sandbox demo PayPal' : 'own sandbox PayPal'} (${token.status})` : 'nothing saved (invoice mode)'}. No card hold.</p>
        </div>
        <button onClick={onShowRenter}>Show the renter phone</button>
      </div>
    </details>
  )
}
