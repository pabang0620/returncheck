import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createClaim } from '../domain/claims.js'
import { ZONE_IDS } from '../domain/rateCard.js'
import { HttpError } from '../http.js'
import { buildPhotoIndex } from './photos.js'
import { DEMO_RENTAL, PHOTO_SETS } from './seed.js'

const sessions = new Map()

const newKey = () => randomBytes(16).toString('hex')

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''))
  const y = Buffer.from(String(b || ''))
  return x.length === y.length && timingSafeEqual(x, y)
}

// Every judge gets a private clone of rental R-1042. The claim id carries a per-session suffix, so the PayPal
// invoice_id, PayPal-Request-Id and invoice number differ between judges. Nothing here is shared except the
// shared demo token id, which is only a reference and carries kind 'demo_shared' (never deletable).
export function createSession({ config, setId = 'A', now = new Date() }) {
  if (!PHOTO_SETS[setId]) throw new HttpError(400, `Unknown photo set ${setId}`)
  while (sessions.size >= config.maxSessions) sessions.delete(sessions.keys().next().value)
  const id = randomUUID()
  const rental = { ...DEMO_RENTAL, gear: DEMO_RENTAL.gear.map((g) => ({ ...g })), status: 'returned', mode: config.paymentMode }
  const session = {
    id,
    staffKey: newKey(),
    renterKey: newKey(),
    createdAt: now.getTime(),
    setId,
    rental,
    claim: createClaim({ id: `CLM-1042-${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`, rentalId: rental.id, limitCents: rental.limitCents }),
    token: config.paymentMode === 'vault' ? { id: config.demoTokenId, kind: 'demo_shared', status: 'active', savedAt: rental.pickupAt } : null,
    photos: buildPhotoIndex(setId, ZONE_IDS),
    inspection: { ran: false, zones: {}, closeupsRequested: [], closeupsUploaded: [], startedAt: null },
    linkSent: false,
    approvals: [],
    invoices: [],
    activity: [],
    pendingSetup: null,
    ownTokenWanted: false,
    closed: false,
    evidencePack: null,
  }
  sessions.set(id, session)
  return session
}

export function getSession(id) {
  const session = sessions.get(id)
  return session || null
}

export function requireSession(id) {
  const session = getSession(id)
  if (!session) throw new HttpError(404, 'Session not found. Start a new demo rental.')
  return session
}

// Keys keep the staff screen, the renter link and other judges apart.
export function authorize(session, role, key) {
  const expected = role === 'staff' ? session.staffKey : session.renterKey
  if (!safeEqual(expected, key)) throw new HttpError(403, `This action needs the ${role} key of this rental.`)
}

export function pruneSessions(config, nowMs = Date.now()) {
  for (const [id, s] of sessions) if (nowMs - s.createdAt > config.sessionTtlMs) sessions.delete(id)
}

export function sessionCount() {
  return sessions.size
}

export function log(session, actor, text, extra = {}) {
  session.activity = [...session.activity, { at: new Date().toISOString(), actor, text, ...extra }].slice(-200)
}
