import { ASSET_HISTORY, PHOTO_SETS } from '../demo/seed.js'
import { computeAllowedActions } from './allowedActions.js'
import { chargeableCents, netPaidCents, refundDueCents, summarize } from './claims.js'
import { ZONES, ZONE_IDS, RATE_CARD } from './rateCard.js'
import { beforePhotoId } from '../demo/photos.js'

const photoUrl = (session, id) => `/api/photos/${session.id}/${id}.svg`

function historyPhoto(item) {
  if (!item.historyRef) return null
  for (const byZone of Object.values(ASSET_HISTORY)) {
    for (const entry of byZone[item.zone] || []) if (entry.rentalId === item.historyRef) return { rentalId: entry.rentalId, returnedAt: entry.returnedAt, url: `/api/photos/history/${entry.photoId}.svg`, verdict: entry.verdict }
  }
  return null
}

function itemView(session, item) {
  return {
    id: item.id,
    no: item.no,
    zone: item.zone,
    zoneLabel: ZONES[item.zone].label,
    rateCode: item.rateCode,
    label: item.label,
    listCents: item.listCents,
    confirmedCents: item.confirmedCents,
    chargeableCents: chargeableCents(item),
    chargedCents: item.chargedCents,
    refundedCents: item.refundedCents,
    refundDueCents: refundDueCents(item),
    description: item.description,
    confidence: item.confidence,
    box: item.box,
    status: item.status,
    preExisting: item.preExisting,
    history: historyPhoto(item),
    contest: item.contest,
    staffNote: item.staffNote,
    photos: item.photoIds.map((id) => ({ id, url: photoUrl(session, id), kind: session.photos[id]?.kind })),
    size: { width: 800, height: 600 },
  }
}

// Monday pickup record (screen A): the six check-out photos, seeded unless staff retook one with a real file.
function pickupView(session) {
  const startMs = Date.parse(session.rental.pickupAt)
  return {
    at: session.rental.pickupAt,
    zones: ZONE_IDS.map((zone, i) => {
      const up = session.uploads?.[`before:${zone}`]
      return {
        zone,
        label: ZONES[zone].label,
        asset: session.rental.gear.find((g) => g.part === ZONES[zone].part)?.name,
        capturedAt: up?.uploadedAt || new Date(startMs + (i + 1) * 90_000).toISOString(),
        source: up ? 'uploaded' : 'seeded',
        url: up ? null : photoUrl(session, beforePhotoId(session.setId, zone)),
      }
    }),
  }
}

const MONEY_ACTIONS = new Set(['request_vault_charge', 'request_refund', 'request_invoice', 'request_token_delete'])

// Whether asking Claude to settle can do anything now: a money action is allowed, or a contest arrived after the
// last settlement run. Otherwise the button is disabled instead of adding a second hold for the same item.
export function settleNeeded(session, allowed = computeAllowedActions(session)) {
  if (!session.linkSent || session.closed) return false
  if (allowed.some((a) => MONEY_ACTIONS.has(a.action))) return true
  const lastRun = session.agentRuns?.settle?.at || ''
  return session.claim.items.some((i) => i.status === 'contested' && (i.contest?.at || '') > lastRun)
}

// Different views per role: the renter never sees staff-only logs or approval cards.
// A hold stays on screen while an item it was placed for is still contested. Once staff upholds, reduces or
// waives it, the hold is resolved and leaves the "Held for staff" card (it stays in the activity log).
function openHolds(session) {
  const contested = new Set(session.claim.items.filter((i) => i.status === 'contested').map((i) => i.id))
  return (session.holds || []).filter((h) => (h.itemIds?.length ? h.itemIds : [...contested]).some((id) => contested.has(id)))
}

export function buildState(session, role, { modes, gateway }) {
  const staff = role === 'staff'
  const items = session.claim.items.map((i) => itemView(session, i))
  const state = {
    sid: session.id,
    role,
    rental: session.rental,
    photoSet: { id: session.setId, ...PHOTO_SETS[session.setId] },
    linkSent: session.linkSent,
    closed: session.closed,
    token: session.token ? { id: session.token.kind === 'demo_shared' ? 'shared demo token' : session.token.id, kind: session.token.kind, status: session.token.status } : null,
    claim: { id: session.claim.id, limitCents: session.claim.limitCents, items: staff ? items : items.filter((i) => i.status !== 'draft' && i.status !== 'dropped'), summary: summarize(session.claim), netPaidCents: netPaidCents(session.claim), charges: session.claim.charges, refunds: session.claim.refunds },
    rateCard: Object.entries(RATE_CARD).map(([code, v]) => ({ code, ...v })),
    modes: { ...modes, paypalCalls: gateway.mode === 'mock' ? 'mock' : 'sandbox live', seeded: 'Photos, dates and fleet history are seeded' },
  }
  if (!staff) return state
  const allowedActions = computeAllowedActions(session)
  return {
    ...state,
    pickup: pickupView(session),
    inspection: session.inspection,
    allowedActions,
    settleNeeded: settleNeeded(session, allowedActions),
    approvals: session.approvals,
    invoices: session.invoices,
    holds: openHolds(session),
    activity: session.activity.slice(-60),
    lastAgent: session.lastAgent || null,
    agentRuns: session.agentRuns || {},
    evidencePack: session.evidencePack,
    disputeWatch: session.disputeWatch || null,
    uploads: Object.fromEntries(Object.entries(session.uploads || {}).map(([k, u]) => [k, { mediaType: u.mediaType, width: u.width, height: u.height, uploadedAt: u.uploadedAt }])),
  }
}
