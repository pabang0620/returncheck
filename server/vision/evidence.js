import { createHash } from 'node:crypto'

export const MIN_EDGE_PX = 200
export const MAX_EDGE_PX = 1568

// Plan 7-2: the server shrinks photos before sending them to Claude, records the sent size, and maps
// the approximate boxes Claude returns back to original pixel coordinates.
export function fitForModel(width, height, maxEdge = MAX_EDGE_PX) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale }
}

export function scaleBoxToOriginal(box, sent, original) {
  const sx = original.width / sent.width
  const sy = original.height / sent.height
  const x = Math.max(0, Math.round(box.x * sx))
  const y = Math.max(0, Math.round(box.y * sy))
  const w = Math.round(box.w * sx)
  const h = Math.round(box.h * sy)
  return { x, y, w: Math.min(w, original.width - x), h: Math.min(h, original.height - y) }
}

// Photos that are too small or blurry are never judged (plan 5-2).
export function checkPhotoQuality({ width, height, sharpness = 1 }) {
  if (Math.min(width, height) < MIN_EDGE_PX) return { ok: false, reason: 'too_small' }
  if (sharpness < 0.35) return { ok: false, reason: 'blurry' }
  return { ok: true }
}

export function photoHash(descriptor) {
  return createHash('sha256').update(JSON.stringify(descriptor)).digest('hex').slice(0, 16)
}

// Evidence record for one capture: who, when, and a hash of what was stored. Not a forgery detector.
export function evidenceRecord(descriptor, capturedAt) {
  return { photoId: descriptor.id, capturedAt, sha256: photoHash(descriptor), width: descriptor.width, height: descriptor.height }
}
