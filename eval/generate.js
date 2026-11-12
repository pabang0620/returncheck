import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CASES } from './cases.js'
import { encodePng } from './png.js'

export const W = 600
export const H = 400

// Small deterministic PRNG so the set is the same on every machine.
const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}

const LIGHT = { warm: { gain: 1, tint: [1, 0.96, 0.88], noise: 5 }, dim: { gain: 0.62, tint: [0.92, 0.96, 1], noise: 9 } }

function paint(zone, defect, lighting, seed, shift) {
  const px = Buffer.alloc(W * H * 3)
  const rand = rng(seed)
  const set = (x, y, [r, g, b]) => { const i = (y * W + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b }
  const light = LIGHT[lighting]
  const base = (x, y) => {
    const inBody = zone === 'lens_front' ? (x - 300 - shift) ** 2 + (y - 200) ** 2 < 170 ** 2 : x > 60 + shift && x < 540 + shift && y > 90 && y < 310
    if (zone === 'lens_front') {
      const d = Math.hypot(x - 300 - shift, y - 200)
      if (d < 70) return [14, 19, 28]
      if (d < 130) return [36, 48, 70]
      if (d < 170) return [30, 32, 38]
      return [233, 229, 219]
    }
    if (!inBody) return [233, 229, 219]
    if (zone === 'lens_barrel') return (Math.floor((x - shift) / 22) % 2 ? [60, 66, 76] : [48, 53, 61])
    return y < 130 ? [69, 76, 87] : [43, 47, 54]
  }
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const [r, g, b] = base(x, y)
      set(x, y, [r, g, b])
    }
  }
  if (defect) {
    const dx = defect.x + shift
    for (let y = defect.y; y < defect.y + defect.h; y += 1) {
      for (let x = dx; x < dx + defect.w; x += 1) {
        const cx = (x - dx) / defect.w - 0.5
        const cy = (y - defect.y) / defect.h - 0.5
        if (defect.kind === 'scratch') set(x, y + Math.round((x - dx) * 0.04), [226, 224, 218])
        else if (cx * cx + cy * cy < 0.25) set(x, y, defect.kind === 'dent' ? (cx + cy < 0 ? [10, 11, 14] : [122, 128, 138]) : [150, 156, 168])
      }
    }
  }
  for (let i = 0; i < px.length; i += 3) {
    const n = (rand() - 0.5) * 2 * light.noise
    for (let c = 0; c < 3; c += 1) px[i + c] = Math.max(0, Math.min(255, Math.round(px[i + c] * light.gain * light.tint[c] + n)))
  }
  return px
}

export function writePair(dir, c, index) {
  const before = paint(c.zone, c.preExisting ? c.defect : null, c.lighting, 1000 + index, 0)
  const after = paint(c.zone, c.expected === 'damage' || c.preExisting ? c.defect : null, c.lighting, 2000 + index, c.preExisting ? 0 : 3)
  fs.writeFileSync(path.join(dir, `${c.id}_before.png`), encodePng(W, H, before))
  fs.writeFileSync(path.join(dir, `${c.id}_after.png`), encodePng(W, H, after))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pairs')
  fs.mkdirSync(dir, { recursive: true })
  CASES.forEach((c, i) => writePair(dir, c, i))
  process.stdout.write(`Wrote ${CASES.length} pairs to ${dir}\n`)
}
