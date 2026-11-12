import { HttpError } from '../http.js'
import { log } from '../demo/sessions.js'
import { afterPhotoId, beforePhotoId, closeupPhotoId } from '../demo/photos.js'
import { PHOTO_SETS } from '../demo/seed.js'
import { ZONES, RATE_CARD } from './rateCard.js'
import { assertOwner } from './decisionTable.js'
import { addItem, getItem, renterAccept, renterContest, staffConfirm, staffDecide, staffDrop, staffMoveBox, STATUS } from './claims.js'

function wrap(fn) {
  try {
    return fn()
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(409, err.message)
  }
}

export function staffConfirmItem(session, itemId) {
  assertOwner('item_confirm', 'human')
  return wrap(() => {
    const { claim } = staffConfirm(session.claim, itemId)
    session.claim = claim
    log(session, 'staff', `Kept ${itemId}.`)
  })
}

export function staffDropItem(session, itemId) {
  assertOwner('item_confirm', 'human')
  return wrap(() => {
    const { claim } = staffDrop(session.claim, itemId)
    session.claim = claim
    log(session, 'staff', `Dropped ${itemId}.`)
  })
}

export function staffMoveItemBox(session, itemId, box) {
  return wrap(() => {
    session.claim = staffMoveBox(session.claim, itemId, box).claim
  })
}

export function sendLink(session) {
  if (!session.inspection.ran) throw new HttpError(409, 'Run the inspection first.')
  const open = session.claim.items.filter((i) => i.status === STATUS.DRAFT)
  if (open.length) throw new HttpError(409, `Keep or drop ${open.map((i) => i.id).join(', ')} first.`)
  session.linkSent = true
  session.rental = { ...session.rental, status: 'link_sent' }
  log(session, 'staff', 'Review link sent to the renter.')
}

export function renterAnswer(session, itemId, answer, { note = '', photoNote = '' } = {}) {
  assertOwner('renter_answer', 'human')
  if (!session.linkSent) throw new HttpError(409, 'The review link has not been sent yet.')
  return wrap(() => {
    if (answer === 'accept') {
      session.claim = renterAccept(session.claim, itemId).claim
      log(session, 'renter', `Accepted ${itemId}.`)
    } else {
      const contest = { note: note.slice(0, 500), photoNote: photoNote.slice(0, 200), at: new Date().toISOString() }
      session.claim = renterContest(session.claim, itemId, contest).claim
      log(session, 'renter', `Contested ${itemId}: ${contest.note || 'no note'}`)
    }
  })
}

export function staffDecideContest(session, itemId, decision, { reducedCents, note }) {
  assertOwner('contest_decision', 'human')
  return wrap(() => {
    session.claim = staffDecide(session.claim, itemId, decision, { reducedCents, note }).claim
    log(session, 'staff', `${decision} on ${itemId}${note ? `: ${note}` : ''}`)
  })
}

export function requestCloseupUpload(session, zone) {
  if (!session.inspection.closeupsRequested.includes(zone)) throw new HttpError(409, 'No close-up was requested for that zone.')
  if (!session.inspection.closeupsUploaded.includes(zone)) session.inspection.closeupsUploaded = [...session.inspection.closeupsUploaded, zone]
  log(session, 'staff', `Seeded close-up for ${ZONES[zone].label} uploaded.`)
}

// Used by agent tools: a draft item from a model finding. The price comes from the rate card by code.
export function draftFinding(session, input) {
  const part = ZONES[input.zone]
  if (!part) throw new HttpError(400, `Unknown zone ${input.zone}`)
  if (!RATE_CARD[input.rate_code]) throw new HttpError(400, `Unknown rate code ${input.rate_code}`)
  const asset = session.rental.gear.find((g) => g.part === part.part)
  const existing = session.claim.items.find((i) => i.zone === input.zone && i.status !== STATUS.DROPPED)
  if (existing) return existing
  const closeup = session.inspection.closeupsUploaded.includes(input.zone)
  const photoIds = [beforePhotoId(session.setId, input.zone), afterPhotoId(session.setId, input.zone), ...(closeup ? [closeupPhotoId(session.setId, input.zone)] : [])]
  const { claim, item } = addItem(session.claim, {
    zone: input.zone,
    assetId: asset.assetId,
    rateCode: input.rate_code,
    description: input.description,
    confidence: input.confidence,
    box: input.box,
    photoIds,
    preExisting: Boolean(input.pre_existing),
    historyRef: input.history_ref || null,
  })
  session.claim = claim
  return item
}

export function photoSetInfo(setId) {
  return PHOTO_SETS[setId]
}

export { getItem }
