import { TOKENS } from './theme.js'
import { useWidgetRows } from './useWidgetRows.js'

const box = { padding: 12, height: '100%', fontFamily: TOKENS.font, color: TOKENS.ink }

export function RecoveryTile({ widgetApi, dataMapping }) {
  const billed = dataMapping.billed?.[0]
  const recovered = dataMapping.recovered?.[0]
  const { rows, loaded } = useWidgetRows(widgetApi, [billed, recovered].filter(Boolean))
  if (!billed || !recovered) return <div style={box}>Map billed and recovered.</div>
  if (!loaded) return <div style={box} role="status">Loading recovery...</div>
  const b = Number(rows[0]?.[billed.key] || 0)
  const r = Number(rows[0]?.[recovered.key] || 0)
  const pct = b ? Math.round((r / b) * 100) : 0
  return (
    <div style={box}>
      <div style={{ fontSize: 34, lineHeight: '40px', fontWeight: 800, letterSpacing: '-.02em', color: TOKENS.accent }}>{pct}%</div>
      <div style={{ marginTop: 4 }}>${Math.round(r).toLocaleString()} net recovered (after refunds) of ${Math.round(b).toLocaleString()} billed</div>
      <div style={{ height: 8, background: TOKENS.steps[0], borderRadius: 99, marginTop: 8 }}><div style={{ width: `${pct}%`, height: 8, background: TOKENS.accent, borderRadius: 99 }} /></div>
    </div>
  )
}

const LABELS = { awaiting_inspection: 'Waiting for inspection', awaiting_renter: 'Waiting for renter', awaiting_approval: 'Waiting for approval', closed: 'Closed' }

export function QueueWidget({ widgetApi, dataMapping }) {
  const status = dataMapping.status?.[0]
  const count = dataMapping.count?.[0]
  const { rows, selections, loaded } = useWidgetRows(widgetApi, [status, count].filter(Boolean))
  if (!status || !count) return <div style={box}>Map a status and a count.</div>
  if (!loaded) return <div style={box} role="status">Loading queue...</div>
  const by = Object.fromEntries(rows.map((r) => [r[status.key], Number(r[count.key])]))
  const selected = new Set((selections || []).flatMap((s) => (s.type === 'value' ? s.values : [])))
  return (
    <div style={{ ...box, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {['awaiting_inspection', 'awaiting_renter', 'awaiting_approval'].map((s) => (
        <button key={s} type="button" onClick={() => widgetApi.toggleCrossFilter({ type: 'value', field: status, value: s, group: 1 })}
          style={{ textAlign: 'left', border: `1px solid ${selected.has(s) ? TOKENS.accent : TOKENS.line}`, borderRadius: 12, background: selected.has(s) ? TOKENS.steps[0] : '#F7FAFC', padding: 8, cursor: 'pointer', color: TOKENS.ink }}>
          <div style={{ fontSize: 26, fontWeight: 800 }}>{by[s] || 0}</div>
          <div style={{ fontSize: 12, color: TOKENS.muted }}>{LABELS[s]}</div>
        </button>
      ))}
    </div>
  )
}
