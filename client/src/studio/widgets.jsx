import { createWidgets } from 'ag-studio-react'
import { DamageMap } from './DamageMap.jsx'
import { QueueWidget, RecoveryTile } from './Tiles.jsx'

const field = (roles, required = true) => ({ type: 'field', supportedRoles: roles, required })

// Compose panel thumbnails (our own static SVG, no user input). Without an icon the panel shows an empty box.
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 32" width="48" height="32" fill="none" stroke="currentColor" stroke-width="2">${body}</svg>`
const ICONS = {
  'damage-map': svg('<rect x="4" y="8" width="20" height="18" rx="3"/><rect x="26" y="12" width="18" height="12" rx="2"/><path d="M10 8 l3 -4 h6 l3 4"/>'),
  recovery: svg('<path d="M6 12 h22"/><rect x="6" y="20" width="36" height="5" rx="2"/><rect x="6" y="20" width="26" height="5" rx="2" fill="currentColor"/>'),
  queue: svg('<rect x="3" y="7" width="12" height="18" rx="2"/><rect x="18" y="7" width="12" height="18" rx="2"/><rect x="33" y="7" width="12" height="18" rx="2"/>'),
}

function definition({ id, label, mapping, items, comp, size, crossFilter = false }) {
  return {
    id,
    label,
    icon: ICONS[id],
    dataMapping: mapping,
    form: ({ createDefaults }) => createDefaults({ dataMappingItems: items, supportsTriggerCrossFilter: crossFilter }),
    comp,
    defaultSize: size,
    minSize: { width: 4, height: 6 },
    toolbar: ['duplicate', 'delete'],
    featureConfig: crossFilter ? { crossFilter: { supportsHighlight: false } } : undefined,
    ai: { label, description: `${label} widget for the rental shop dashboard` },
  }
}

export const widgets = createWidgets({
  additionalTypes: [
    definition({ id: 'damage-map', label: 'Damage map', mapping: { zone: field(['category']), value: field(['numeric', 'category'], false) }, items: [{ key: 'zone', label: 'Zone' }, { key: 'value', label: 'Amount' }], comp: DamageMap, size: { width: 10, height: 22 }, crossFilter: true }),
    definition({ id: 'recovery', label: 'Recovery rate', mapping: { billed: field(['numeric', 'category']), recovered: field(['numeric', 'category']) }, items: [{ key: 'billed', label: 'Billed' }, { key: 'recovered', label: 'Recovered' }], comp: RecoveryTile, size: { width: 6, height: 9 } }),
    definition({ id: 'queue', label: 'Contest and approval queue', mapping: { status: field(['category']), count: field(['numeric', 'category']) }, items: [{ key: 'status', label: 'Status' }, { key: 'count', label: 'Count' }], comp: QueueWidget, size: { width: 10, height: 9 }, crossFilter: true }),
  ],
  menu: [{ label: 'ReturnCheck', widgetIds: ['damage-map', 'recovery', 'queue'] }],
})
