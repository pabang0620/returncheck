// The shop's published rate card. Prices live here and nowhere else: a model names a code, the server prices it.
export const RATE_CARD = Object.freeze({
  'SCR-S': { label: 'Small scratch', cents: 3500 },
  'SCR-L': { label: 'Long or deep scratch', cents: 8500 },
  'DNT-M': { label: 'Mount or edge dent', cents: 12000 },
  'LCD-S': { label: 'LCD scratch', cents: 9500 },
  'MRK-B': { label: 'Barrel mark', cents: 4000 },
  'LNS-F': { label: 'Front element mark', cents: 15000 },
})

export const ZONES = Object.freeze({
  body_front: { label: 'Body front', part: 'body' },
  top_plate: { label: 'Top plate', part: 'body' },
  rear_lcd: { label: 'Rear LCD', part: 'body' },
  lens_front: { label: 'Lens front element', part: 'lens' },
  lens_barrel: { label: 'Lens barrel', part: 'lens' },
  lens_mount: { label: 'Lens mount', part: 'lens' },
})

export const ZONE_IDS = Object.keys(ZONES)
export const RATE_CODES = Object.keys(RATE_CARD)

export function priceOf(code) {
  const entry = RATE_CARD[code]
  if (!entry) throw new Error(`Unknown rate card code ${code}`)
  return entry.cents
}

export function labelOf(code) {
  const entry = RATE_CARD[code]
  if (!entry) throw new Error(`Unknown rate card code ${code}`)
  return entry.label
}
