import { TOKENS } from './theme.js'
import { useWidgetRows } from './useWidgetRows.js'

// Camera and lens outline; each zone is a shape colored by billed amount. Clicking a zone is a cross filter.
const SHAPES = {
  top_plate: { label: 'Top plate', d: 'M30 50 h150 v36 h-150 z', rx: 10 },
  body_front: { label: 'Body front', d: 'M30 92 h150 v100 h-150 z', rx: 12 },
  rear_lcd: { label: 'Rear LCD', d: 'M186 92 h70 v100 h-70 z', rx: 8 },
  lens_mount: { label: 'Mount', d: 'M262 92 h40 v100 h-40 z', rx: 4 },
  lens_front: { label: 'Front', d: 'M308 98 h50 v88 h-50 z', rx: 8 },
  lens_barrel: { label: 'Barrel', d: 'M364 104 h96 v76 h-96 z', rx: 8 },
}

function shapeRect(id) {
  const m = SHAPES[id].d.match(/M(\d+) (\d+) h(\d+) v(\d+)/)
  return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] }
}

export function DamageMap({ widgetApi, dataMapping }) {
  const zoneField = dataMapping.zone?.[0]
  const valueField = dataMapping.value?.[0]
  const { rows, selections, loaded } = useWidgetRows(widgetApi, [zoneField, valueField].filter(Boolean))
  if (!zoneField) return <div style={{ padding: 12 }}>Map a zone field to see the damage map.</div>
  if (!loaded) return <div style={{ padding: 12, fontFamily: TOKENS.font, color: TOKENS.ink }} role="status">Loading the damage map...</div>
  const totals = Object.fromEntries(rows.map((r) => [r[zoneField.key], Number(valueField ? r[valueField.key] : 1)]))
  const max = Math.max(1, ...Object.values(totals))
  const selected = new Set((selections || []).flatMap((s) => (s.type === 'value' ? s.values : [])))
  const color = (v) => (!v ? TOKENS.steps[0] : TOKENS.steps[1 + Math.min(3, Math.floor((v / max) * 3.99))])

  return (
    <svg viewBox="0 0 480 250" style={{ width: '100%', height: '100%', fontFamily: TOKENS.font }} role="group" aria-label="Damage map">
      <path d="M70 50 l16 -22 h60 l16 22 z" fill="none" stroke={TOKENS.muted} strokeWidth="2" />
      <circle cx="116" cy="40" r="5" fill={TOKENS.muted} />
      <path d="M24 44 h162 v154 h-162 z M186 86 h116 M302 98 h160 v84 h-160 z" fill="none" stroke={TOKENS.muted} strokeWidth="2" strokeLinejoin="round" />
      {Object.keys(SHAPES).map((id) => {
        const { x, y, w, h } = shapeRect(id)
        const on = selected.has(id)
        const dark = color(totals[id] || 0) === TOKENS.steps[3] || color(totals[id] || 0) === TOKENS.steps[4]
        const ink = dark ? '#fff' : TOKENS.ink
        const v = totals[id] || 0
        // Narrow zones (Mount) get smaller text so the label and the amount do not touch the edges.
        const small = w < 60
        return (
          <g key={id} style={{ cursor: 'pointer' }} onClick={() => widgetApi.toggleCrossFilter({ type: 'value', field: zoneField, value: id, group: 0 })}>
            <rect x={x} y={y} width={w} height={h} rx={SHAPES[id].rx} fill={color(v)} stroke={on ? TOKENS.ink : TOKENS.lineStrong} strokeWidth={on ? 3 : 1} />
            <text x={x + w / 2} y={y + h / 2 - 3} textAnchor="middle" fontSize={small ? 10 : 13} fill={ink}>{SHAPES[id].label}</text>
            <text x={x + w / 2} y={y + h / 2 + 15} textAnchor="middle" fontSize={small ? 11 : 14} fontWeight="700" fill={ink}>{valueField ? `$${Math.round(v)}` : v}</text>
          </g>
        )
      })}
      <text x="24" y="226" fontSize="12" fill={TOKENS.ink}>Darker means more billed. Click a zone to filter every widget.</text>
    </svg>
  )
}
