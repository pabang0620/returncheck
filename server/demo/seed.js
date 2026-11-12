// Seeded data for the judge demo. Dates are seeded: a one-week rental cannot be waited for in a demo.
export const DEMO_RENTAL = Object.freeze({
  id: 'R-1042',
  shop: 'Harbor Camera Rentals',
  renter: { name: 'Jordan Lee', email: 'jordan.lee@example.com' },
  gear: [
    { assetId: 'ASSET-A7IV-03', part: 'body', name: 'Sony A7 IV body' },
    { assetId: 'ASSET-2470-11', part: 'lens', name: 'Sony 24-70mm f/2.8 GM II' },
  ],
  pickupAt: '2026-11-30T09:40:00Z',
  returnedAt: '2026-12-07T11:30:00Z',
  returnedTo: 'Mina (counter)',
  inspectedAt: '2026-12-08T09:05:00Z',
  limitCents: 30000,
  days: 7,
  datesSeeded: true,
})

export const PHOTO_SETS = Object.freeze({
  A: { label: 'Set A: scratch, dent, old barrel mark', note: 'Inspection already done when the demo opens' },
  B: { label: 'Set B: ambiguous front element, close-up needed', note: 'Claude asks for a close-up; the seeded close-up is uploaded with one click' },
  C: { label: 'Set C: no new damage, old marks only', note: 'Everything found was already there in earlier returns' },
})

// Past returns of the same assets (what get_asset_history reads).
export const ASSET_HISTORY = Object.freeze({
  'ASSET-2470-11': {
    lens_barrel: [
      { rentalId: 'R-0977', returnedAt: '2026-10-19T10:15:00Z', photoId: 'H-0977-lens_barrel', verdict: 'mark present at return, not billed (borderline)', hasMark: true },
      { rentalId: 'R-1011', returnedAt: '2026-11-09T11:00:00Z', photoId: 'H-1011-lens_barrel', verdict: 'same mark visible, no new damage', hasMark: true },
    ],
  },
  'ASSET-A7IV-03': {
    body_front: [
      { rentalId: 'R-0990', returnedAt: '2026-11-02T10:40:00Z', photoId: 'H-0990-body_front', verdict: 'light scuff near the grip, not billed', hasMark: true },
    ],
  },
})

// Photo descriptors: id -> what the SVG renderer draws. Coordinates are in the 800x600 original.
export function photoDescriptor(setId, kind, zone) {
  const clean = { id: `${setId}-${kind}-${zone}`, zone, kind, width: 800, height: 600, defects: [] }
  const defects = (list) => ({ ...clean, defects: list })
  if (kind === 'before') {
    if (zone === 'lens_barrel') return clean
    if (setId === 'C' && zone === 'body_front') return defects([{ kind: 'mark', x: 520, y: 380, w: 70, h: 36 }])
    return clean
  }
  if (kind === 'closeup') {
    if (setId === 'B' && zone === 'lens_front') return { ...clean, id: 'B-closeup-lens_front', defects: [{ kind: 'mark', x: 300, y: 220, w: 200, h: 160 }] }
    return clean
  }
  if (setId === 'A') {
    if (zone === 'top_plate') return defects([{ kind: 'scratch', x: 300, y: 196, w: 130, h: 6 }])
    if (zone === 'lens_barrel') return defects([{ kind: 'mark', x: 500, y: 300, w: 60, h: 40 }])
    if (zone === 'lens_mount') return defects([{ kind: 'dust', x: 120, y: 380, w: 70, h: 50 }])
  }
  if (setId === 'B' && zone === 'lens_front') return defects([{ kind: 'mark', x: 360, y: 262, w: 40, h: 40 }])
  if (setId === 'C') {
    if (zone === 'lens_barrel') return defects([{ kind: 'mark', x: 500, y: 300, w: 60, h: 40 }])
    if (zone === 'body_front') return defects([{ kind: 'mark', x: 520, y: 380, w: 70, h: 36 }])
  }
  return clean
}

export function historyPhotoDescriptor(photoId, zone, hasMark) {
  const base = { id: photoId, zone, kind: 'history', width: 800, height: 600, defects: [] }
  if (!hasMark) return base
  if (zone === 'lens_barrel') return { ...base, defects: [{ kind: 'mark', x: 500, y: 300, w: 60, h: 40 }] }
  return { ...base, defects: [{ kind: 'mark', x: 520, y: 380, w: 70, h: 36 }] }
}
