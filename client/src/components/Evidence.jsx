import { useRef, useState } from 'react'

const W = 800
const H = 600

// Zoomed view of the box on the check-in photo (the "evidence crop"): an SVG viewBox over the same image.
export function Crop({ url, box, label }) {
  const pad = 40
  const x = Math.max(0, box.x - pad)
  const y = Math.max(0, box.y - pad)
  const w = Math.min(W - x, box.w + pad * 2)
  const h = Math.min(H - y, box.h + pad * 2)
  return (
    <svg className="crop" viewBox={`${x} ${y} ${w} ${h}`} role="img" aria-label={label}>
      <image href={url} width={W} height={H} />
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="none" stroke="#E11D48" strokeWidth="3" />
    </svg>
  )
}

// Photo with the detected box. With `onBoxChange` the box can be dragged (staff fixes Claude's coordinates).
export function PhotoWithBox({ url, box, caption, onBoxChange }) {
  const ref = useRef(null)
  const [drag, setDrag] = useState(null)
  const live = drag || box

  function start(e) {
    if (!onBoxChange || !box) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ ...box, startX: e.clientX, startY: e.clientY, orig: box })
  }
  function move(e) {
    if (!drag) return
    const rect = ref.current.getBoundingClientRect()
    const dx = ((e.clientX - drag.startX) / rect.width) * W
    const dy = ((e.clientY - drag.startY) / rect.height) * H
    const x = Math.round(Math.min(W - drag.orig.w, Math.max(0, drag.orig.x + dx)))
    const y = Math.round(Math.min(H - drag.orig.h, Math.max(0, drag.orig.y + dy)))
    setDrag({ ...drag, x, y })
  }
  function end() {
    if (!drag) return
    const { x, y, w, h } = drag
    setDrag(null)
    if (x !== box.x || y !== box.y) onBoxChange({ x, y, w, h })
  }

  return (
    <figure>
      <div className="photo" ref={ref}>
        <img src={url} alt={caption} draggable={false} />
        {live && (
          <div
            className="photo__box"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            style={{ left: `${(live.x / W) * 100}%`, top: `${(live.y / H) * 100}%`, width: `${(live.w / W) * 100}%`, height: `${(live.h / H) * 100}%`, cursor: onBoxChange ? 'move' : 'default' }}
          />
        )}
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

export function BeforeAfter({ item, onBoxChange }) {
  const before = item.photos.find((p) => p.kind === 'before')
  const after = item.photos.find((p) => p.kind === 'after')
  return (
    <div className="pair">
      <PhotoWithBox url={before.url} caption="Check-out" />
      <PhotoWithBox url={after.url} box={item.box} caption={onBoxChange ? 'Check-in (drag the box)' : 'Check-in'} onBoxChange={onBoxChange} />
    </div>
  )
}
