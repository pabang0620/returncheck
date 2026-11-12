// Studio data sources from the fleet endpoint. billed_amount is a plain sum column; recovered_amount arrives from the server already net of refunds.
const BILLABLE = new Set(['charged', 'accepted', 'staff_upheld', 'reduced', 'contested', 'staff_ok', 'refunded'])

export function buildSources(fleet) {
  const items = fleet.items.map((i) => ({
    ...i,
    billed_amount: BILLABLE.has(i.state) ? i.amount : 0,
  }))
  return {
    sources: [
      { id: 'items', name: 'Claim items', data: items, fields: withFields(items) },
      { id: 'rentals', name: 'Rentals', data: fleet.rentals, fields: withFields(fleet.rentals) },
      { id: 'charges', name: 'PayPal charges', data: fleet.charges, fields: withFields(fleet.charges) },
      { id: 'assets', name: 'Assets', data: fleet.assets, fields: withFields(fleet.assets) },
    ],
  }
}

// Human column names. Without them AG Studio prints the raw ids ("Item_id", "Paypal_or...").
const NAMES = { item_id: 'Item', rental_id: 'Rental', zone: 'Zone', rate_code: 'Rate code', amount: 'Amount ($)', state: 'State', source: 'Source', charge_id: 'Charge', paypal_order: 'PayPal order', status: 'Status', category: 'Gear', month: 'Month', billed_amount: 'Billed ($)', recovered_amount: 'Net recovered ($, charged minus refunded)', asset_id: 'Asset', start: 'Start', days: 'Days', damaged: 'Damaged', billed: 'Billed ($)', recovered: 'Net recovered ($)' }
const label = (id) => NAMES[id] || id.charAt(0).toUpperCase() + id.slice(1).replaceAll('_', ' ')

function withFields(rows) {
  const first = rows[0] || {}
  return Object.keys(first).map((id) => ({ id, name: label(id), format: typeof first[id] === 'number' ? 'decimalFormat' : typeof first[id] === 'boolean' ? 'booleanFormat' : 'textFormat' }))
}

const f = (id, aggregation) => (aggregation ? { id, aggregation } : { id })

export function initialReport() {
  return {
    pages: [{
      id: 'morning',
      layout: { columns: 24, rowHeight: 16 },
      widgets: {
        queue: { type: 'queue', dataMapping: { status: [f('rentals.status')], count: [f('rentals.rental_id', 'count')] }, format: { title: { enabled: true, text: 'Today queue', typography: { fontSize: 14, fontWeight: 'bold' } } } },
        recovery: { type: 'recovery', dataMapping: { billed: [f('items.billed_amount', 'sum')], recovered: [f('items.recovered_amount', 'sum')] }, format: { title: { enabled: true, text: 'Net recovered (charged minus refunds)', typography: { fontSize: 14, fontWeight: 'bold' } } } },
        map: { type: 'damage-map', dataMapping: { zone: [f('items.zone')], value: [f('items.amount', 'sum')] }, format: { title: { enabled: true, text: 'Damage map: click a zone', typography: { fontSize: 14, fontWeight: 'bold' } } } },
        category: { type: 'column-chart-grouped', dataMapping: { categoryKey: [f('items.category')], valueKey: [f('items.billed_amount', 'sum'), f('items.recovered_amount', 'sum')] }, format: { title: { enabled: true, text: 'Billed and recovered by gear', typography: { fontSize: 14, fontWeight: 'bold' } } } },
        trend: { type: 'line-chart', dataMapping: { categoryKey: [f('items.month')], valueKey: [f('items.billed_amount', 'sum'), f('items.recovered_amount', 'sum')] }, format: { title: { enabled: true, text: 'Month by month', typography: { fontSize: 14, fontWeight: 'bold' } } } },
        claims: { type: 'grid', dataMapping: { cols: [f('items.item_id'), f('items.rental_id'), f('items.zone'), f('items.rate_code'), f('items.amount'), f('items.state'), f('items.source')] }, format: { title: { enabled: true, text: 'Claim items', typography: { fontSize: 14, fontWeight: 'bold' } }, style: { columnAutoSize: true } } },
        charges: { type: 'grid', dataMapping: { cols: [f('charges.charge_id'), f('charges.rental_id'), f('charges.paypal_order'), f('charges.amount'), f('charges.status'), f('charges.source')] }, format: { title: { enabled: true, text: 'PayPal charges (from this app\'s orders)', typography: { fontSize: 14, fontWeight: 'bold' } }, style: { columnAutoSize: true } } },
      },
      widgetLayout: {
        queue: { xTrack: 0, yTrack: 0, xSpan: 10, ySpan: 9 },
        recovery: { xTrack: 10, yTrack: 0, xSpan: 6, ySpan: 9 },
        map: { xTrack: 0, yTrack: 9, xSpan: 10, ySpan: 22 },
        category: { xTrack: 16, yTrack: 0, xSpan: 8, ySpan: 31 },
        trend: { xTrack: 10, yTrack: 9, xSpan: 6, ySpan: 22 },
        claims: { xTrack: 0, yTrack: 31, xSpan: 12, ySpan: 24 },
        charges: { xTrack: 12, yTrack: 31, xSpan: 12, ySpan: 24 },
      },
    }],
    selectedPageId: 'morning',
    panels: { edit: { width: 280 }, ai: { width: 300 } },
  }
}
