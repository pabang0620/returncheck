import { useState } from 'react'
import evidence from '../../../photo-sets/A/results.json'
import { RATE_CARD, ZONES } from '../../../server/domain/rateCard.js'

// Only the twelve release images are part of the public bundle.
const images = import.meta.glob('../../../photo-sets/A/{body_front,top_plate,rear_lcd,lens_front,lens_barrel,lens_mount}_{checkout,return}.jpg', { eager: true, query: '?url', import: 'default' })
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function PhotoEvidence() {
  const [zone, setZone] = useState('top_plate')
  const row = evidence.rows.find(item => item.zone === zone)
  const rate = RATE_CARD[row.rateCode]
  return (
    <details className="photo-evidence">
      <summary>View six AI-generated photo comparisons</summary>
      <p>Google Flow generated these test images. This recorded Sonnet inspection is separate from the illustrated rental. No charge is created here.</p>
      <label>Camera zone <select value={zone} onChange={event => setZone(event.target.value)}>
        {evidence.rows.map(item => <option key={item.zone} value={item.zone}>{ZONES[item.zone].label}</option>)}
      </select></label>
      <div className="photo-pair">
        {['checkout', 'return'].map(stage => (
          <figure key={stage}>
            <figcaption>{stage === 'checkout' ? 'At pickup' : 'At return'}</figcaption>
            <img loading="lazy" src={images[`../../../photo-sets/A/${zone}_${stage}.jpg`]} alt={`${ZONES[zone].label} at ${stage}`} />
          </figure>
        ))}
      </div>
      <p><strong>{rate ? `${rate.label} · ${row.rateCode} · shop rate ${usd.format(rate.cents / 100)}` : row.preExisting ? 'Pre-existing mark · no new damage' : 'No new damage'}</strong></p>
      <p>{row.note}</p>
    </details>
  )
}
