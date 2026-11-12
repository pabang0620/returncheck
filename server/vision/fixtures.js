// Seeded comparison results for the drawn demo photo pairs. Written by hand for these SVG drawings, not model
// output (vision runs only on real JPEG/PNG records). Boxes are in the coordinates of the
// downscaled 400x300 view of these 800x600 photos; evidence.js maps them back.
export const MODEL_VIEW = { width: 400, height: 300 }

const none = (note = 'No visible difference between check-out and check-in photos') => ({ verdict: 'none', confidence: 'high', note })

export const VISION_FIXTURES = Object.freeze({
  A: {
    body_front: none(),
    rear_lcd: none(),
    lens_front: none(),
    top_plate: { verdict: 'damage', confidence: 'high', rateCode: 'SCR-S', box: { x: 140, y: 92, w: 80, h: 16 }, note: 'New thin scratch across the top plate, absent in the check-out photo' },
    lens_barrel: { verdict: 'damage', confidence: 'medium', rateCode: 'MRK-B', box: { x: 245, y: 145, w: 40, h: 30 }, note: 'Mark on the barrel, not visible in the check-out photo' },
    lens_mount: { verdict: 'damage', confidence: 'medium', rateCode: 'DNT-M', box: { x: 55, y: 185, w: 45, h: 35 }, note: 'Possible dent on the mount edge, absent in the check-out photo' },
  },
  B: {
    body_front: none(),
    top_plate: none(),
    rear_lcd: none(),
    lens_mount: none(),
    lens_barrel: none(),
    lens_front: { verdict: 'uncertain', confidence: 'low', box: { x: 170, y: 125, w: 40, h: 40 }, note: 'Something small on the front element; could be a smudge or a mark. A close-up is needed' },
  },
  C: {
    body_front: { verdict: 'none', confidence: 'medium', box: { x: 255, y: 185, w: 45, h: 22 }, note: 'A scuff is visible, but it is also in the check-out photo' },
    top_plate: none(),
    rear_lcd: none(),
    lens_mount: none(),
    lens_front: none(),
    lens_barrel: { verdict: 'damage', confidence: 'medium', rateCode: 'MRK-B', box: { x: 245, y: 145, w: 40, h: 30 }, note: 'Mark on the barrel, not visible in the check-out photo of this rental' },
  },
})

// What Claude says after seeing the close-up (set B only).
export const CLOSEUP_FIXTURES = Object.freeze({
  B: { lens_front: { verdict: 'damage', confidence: 'high', rateCode: 'LNS-F', box: { x: 150, y: 110, w: 100, h: 80 }, note: 'The close-up shows a coating mark on the front element' } },
})
