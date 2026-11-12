import { RATE_CARD, ZONE_IDS } from '../domain/rateCard.js'
import { netPaidCents } from '../domain/claims.js'

// Seeded shop history for the AG Studio dashboard: three months of rentals. Only the live demo rental's
// PayPal transaction is real (sandbox) or mock, and rows say so in the `source` column.
function rng(seed) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CATEGORIES = ['Mirrorless body', 'Zoom lens', 'Prime lens', 'Cinema kit', 'Video body']
const STATUSES = ['closed', 'closed', 'closed', 'closed', 'awaiting_inspection', 'awaiting_renter', 'awaiting_approval']
const CODES = Object.keys(RATE_CARD)
const STATE_OF = ['charged', 'charged', 'charged', 'waived', 'contested', 'accepted']

export function buildSeedFleet() {
  const rand = rng(1042)
  const rentals = []
  const items = []
  const charges = []
  const assets = CATEGORIES.flatMap((cat, c) => Array.from({ length: 3 }, (_, n) => ({ asset_id: `ASSET-${c}${n}`, name: `${cat} #${n + 1}`, category: cat, rentals: 0, damage_items: 0 })))
  for (let n = 0; n < 72; n += 1) {
    const day = Math.floor(rand() * 84)
    const start = new Date(Date.UTC(2026, 8, 7 + day))
    const days = 2 + Math.floor(rand() * 8)
    const asset = assets[Math.floor(rand() * assets.length)]
    const status = day > 74 ? STATUSES[4 + Math.floor(rand() * 3)] : STATUSES[Math.floor(rand() * 4)]
    const rentalId = `R-${String(900 + n).padStart(4, '0')}`
    const damaged = rand() < 0.3
    asset.rentals += 1
    let billed = 0
    let recovered = 0
    if (damaged) {
      const count = 1 + Math.floor(rand() * 2)
      for (let k = 0; k < count; k += 1) {
        const code = CODES[Math.floor(rand() * CODES.length)]
        const zone = ZONE_IDS[Math.floor(rand() * ZONE_IDS.length)]
        const state = status === 'closed' ? STATE_OF[Math.floor(rand() * 4)] : STATE_OF[4 + Math.floor(rand() * 2)]
        const cents = RATE_CARD[code].cents
        billed += cents
        if (state === 'charged') recovered += cents
        asset.damage_items += 1
        items.push({ item_id: `${rentalId}-${k + 1}`, rental_id: rentalId, zone, rate_code: code, amount: cents / 100, state, category: asset.category, month: start.toISOString().slice(0, 7), recovered_amount: state === 'charged' ? cents / 100 : 0, source: 'seeded' })
        if (state === 'charged') charges.push({ charge_id: `${rentalId}-c${k + 1}`, rental_id: rentalId, paypal_order: `SEED${n}${k}`, amount: cents / 100, status: 'COMPLETED', source: 'seeded' })
      }
    }
    rentals.push({ rental_id: rentalId, asset_id: asset.asset_id, category: asset.category, start: start.toISOString().slice(0, 10), month: start.toISOString().slice(0, 7), days, status, damaged, billed: billed / 100, recovered: recovered / 100, source: 'seeded' })
  }
  return { rentals, items, charges, assets }
}

const byMonth = (a, b) => a.month.localeCompare(b.month)
const raw = buildSeedFleet()
// Months ascend so the line chart reads left to right in time order.
const BASE = { ...raw, rentals: [...raw.rentals].sort(byMonth), items: [...raw.items].sort(byMonth) }

// recovered_amount is net: money charged minus money refunded on the item, computed here and never in the browser.
// Fleet plus the rows of one live demo session (if given) so the dashboard shows this judge's rental.
export function fleetFor(session, gatewayMode) {
  const fleet = { rentals: [...BASE.rentals], items: [...BASE.items], charges: [...BASE.charges], assets: BASE.assets.map((a) => ({ ...a })) }
  if (!session) return fleet
  const source = gatewayMode === 'mock' ? 'mock (this session)' : 'sandbox live (this session)'
  const { claim, rental } = session
  const billed = claim.items.filter((i) => !['dropped', 'draft'].includes(i.status)).reduce((s, i) => s + i.listCents, 0)
  const status = session.closed ? 'closed' : session.approvals.some((a) => a.status === 'pending') ? 'awaiting_approval' : session.linkSent ? 'awaiting_renter' : session.inspection.ran ? 'awaiting_renter' : 'awaiting_inspection'
  fleet.rentals.push({ rental_id: rental.id, asset_id: rental.gear[0].assetId, category: 'Mirrorless body', start: rental.pickupAt.slice(0, 10), month: rental.pickupAt.slice(0, 7), days: rental.days, status, damaged: claim.items.some((i) => !i.preExisting), billed: billed / 100, recovered: netPaidCents(claim) / 100, source })
  for (const i of claim.items.filter((x) => !x.preExisting)) {
    fleet.items.push({ item_id: `${rental.id}-${i.no}`, rental_id: rental.id, zone: i.zone, rate_code: i.rateCode, amount: i.listCents / 100, state: i.status, category: 'Mirrorless body', month: rental.pickupAt.slice(0, 7), recovered_amount: (i.chargedCents - i.refundedCents) / 100, source })
  }
  for (const c of claim.charges.filter((x) => x.status === 'COMPLETED')) {
    fleet.charges.push({ charge_id: c.requestId, rental_id: rental.id, paypal_order: c.orderId, amount: c.amountCents / 100, status: c.status, source: c.source })
  }
  return { ...fleet, rentals: [...fleet.rentals].sort(byMonth), items: [...fleet.items].sort(byMonth) }
}
