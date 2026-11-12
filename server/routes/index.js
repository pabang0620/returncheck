import express from 'express'
import { z } from 'zod'
import { config, modes } from '../config.js'
import { ACTION } from '../domain/allowedActions.js'
import { approve, rejectApproval } from '../domain/approvals.js'
import { DECISIONS } from '../domain/decisionTable.js'
import { closeRental, runInspection, runSettlement } from '../domain/inspect.js'
import { renterAnswer, requestCloseupUpload, sendLink, staffConfirmItem, staffDecideContest, staffDropItem, staffMoveItemBox } from '../domain/service.js'
import { finishSave, simulateRevoke, startSave } from '../domain/tokenFlow.js'
import { buildState } from '../domain/view.js'
import { renderPhotoSvg } from '../demo/photos.js'
import { historyPhotoDescriptor, ASSET_HISTORY } from '../demo/seed.js'
import { fleetFor } from '../demo/fleet.js'
import { authorize, createSession, pruneSessions, requireSession } from '../demo/sessions.js'
import { HttpError, idSchema, parse } from '../http.js'
import { mountExtras } from './extras.js'
import { studioRouter } from './studio.js'

const withAuth = (role) => (req, res, next) => {
  try {
    req.session = requireSession(req.params.sid)
    authorize(req.session, role, req.get(role === 'staff' ? 'x-staff-key' : 'x-renter-key'))
    next()
  } catch (err) {
    next(err)
  }
}

const handler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res)
  } catch (err) {
    next(err)
  }
}

const boxSchema = z.object({ x: z.number().int().min(0).max(800), y: z.number().int().min(0).max(600), w: z.number().int().min(4).max(800), h: z.number().int().min(4).max(600) })

export function createApi(gateway) {
  const api = express.Router()
  const stateOf = (session, role) => buildState(session, role, { modes, gateway })
  const ok = (res, session, role, extra = {}) => res.json({ success: true, data: { state: stateOf(session, role), ...extra } })

  api.get('/health', (req, res) => res.json({ success: true, data: { modes, paypalCalls: gateway.mode } }))
  api.get('/decisions', (req, res) => res.json({ success: true, data: DECISIONS }))

  api.post('/demo', handler(async (req, res) => {
    const { set } = parse(z.object({ set: z.enum(['A', 'B', 'C']).default('A') }), req.body ?? {})
    pruneSessions(config)
    const session = createSession({ config, setId: set })
    if (set === 'A') await runInspection(session, gateway)
    res.status(201).json({ success: true, data: { sid: session.id, staffKey: session.staffKey, renterKey: session.renterKey, state: stateOf(session, 'staff') } })
  }))

  api.get('/s/:sid/state/:role', handler(async (req, res) => {
    const role = parse(z.enum(['staff', 'renter']), req.params.role)
    const session = requireSession(req.params.sid)
    authorize(session, role, req.get(role === 'staff' ? 'x-staff-key' : 'x-renter-key'))
    res.json({ success: true, data: { state: stateOf(session, role) } })
  }))

  // ---- staff ----
  const staff = withAuth('staff')
  api.post('/s/:sid/inspect', staff, handler(async (req, res) => { await runInspection(req.session, gateway); ok(res, req.session, 'staff') }))
  api.post('/s/:sid/closeup', staff, handler(async (req, res) => {
    const { zone } = parse(z.object({ zone: z.string().min(1).max(30) }), req.body)
    requestCloseupUpload(req.session, zone)
    await runInspection(req.session, gateway)
    ok(res, req.session, 'staff')
  }))
  api.post('/s/:sid/items/:itemId/confirm', staff, handler((req, res) => { staffConfirmItem(req.session, parse(idSchema, req.params.itemId)); ok(res, req.session, 'staff') }))
  api.post('/s/:sid/items/:itemId/drop', staff, handler((req, res) => { staffDropItem(req.session, parse(idSchema, req.params.itemId)); ok(res, req.session, 'staff') }))
  api.post('/s/:sid/items/:itemId/box', staff, handler((req, res) => { staffMoveItemBox(req.session, parse(idSchema, req.params.itemId), parse(boxSchema, req.body)); ok(res, req.session, 'staff') }))
  api.post('/s/:sid/link', staff, handler((req, res) => { sendLink(req.session); ok(res, req.session, 'staff') }))
  api.post('/s/:sid/items/:itemId/decide', staff, handler((req, res) => {
    const body = parse(z.object({ decision: z.enum(['uphold', 'reduce', 'waive']), reducedCents: z.number().int().positive().optional(), note: z.string().max(300).default('') }), req.body)
    staffDecideContest(req.session, parse(idSchema, req.params.itemId), body.decision, body)
    ok(res, req.session, 'staff')
  }))
  api.post('/s/:sid/agent/settle', staff, handler(async (req, res) => { await runSettlement(req.session, gateway); ok(res, req.session, 'staff') }))
  api.post('/s/:sid/approvals/:id/approve', staff, handler(async (req, res) => {
    const approver = parse(z.object({ approver: z.string().min(1).max(40).default('Mina') }), req.body ?? {}).approver
    const approval = await approve(req.session, parse(idSchema, req.params.id), approver, gateway)
    ok(res, req.session, 'staff', { approval })
  }))
  api.post('/s/:sid/approvals/:id/reject', staff, handler((req, res) => { rejectApproval(req.session, parse(idSchema, req.params.id), 'Mina'); ok(res, req.session, 'staff') }))
  api.post('/s/:sid/close', staff, handler((req, res) => { closeRental(req.session); ok(res, req.session, 'staff') }))

  // ---- renter ----
  const renter = withAuth('renter')
  api.post('/s/:sid/items/:itemId/answer', renter, handler((req, res) => {
    const body = parse(z.object({ answer: z.enum(['accept', 'contest']), note: z.string().max(500).default(''), photoNote: z.string().max(200).default('') }), req.body)
    renterAnswer(req.session, parse(idSchema, req.params.itemId), body.answer, body)
    ok(res, req.session, 'renter')
  }))
  api.post('/s/:sid/token/save', renter, handler(async (req, res) => {
    const out = await startSave(req.session, gateway, config)
    res.json({ success: true, data: out })
  }))
  api.post('/s/:sid/token/revoke', renter, handler(async (req, res) => { await simulateRevoke(req.session, gateway); ok(res, req.session, 'renter') }))
  // PayPal sends the payer back here after approval. The setup token id is the proof.
  api.get('/s/:sid/token/return', handler(async (req, res) => {
    const session = requireSession(req.params.sid)
    const setupTokenId = parse(z.string().min(1).max(64), req.query.setup_token_id ?? req.query.approval_token_id ?? req.query.setup)
    await finishSave(session, gateway, setupTokenId)
    res.redirect(`/judge/${session.id}?saved=1`)
  }))

  // ---- photos and fleet ----
  api.get('/photos/history/:file', handler((req, res) => {
    const id = req.params.file.replace(/\.svg$/, '')
    for (const byZone of Object.values(ASSET_HISTORY)) {
      for (const [zone, list] of Object.entries(byZone)) {
        const entry = list.find((e) => e.photoId === id)
        if (entry) return res.type('image/svg+xml').send(renderPhotoSvg(historyPhotoDescriptor(id, zone, entry.hasMark)))
      }
    }
    throw new HttpError(404, 'Photo not found.')
  }))
  api.get('/photos/:sid/:file', handler((req, res) => {
    const session = requireSession(req.params.sid)
    const descriptor = session.photos[req.params.file.replace(/\.svg$/, '')]
    if (!descriptor) throw new HttpError(404, 'Photo not found.')
    res.type('image/svg+xml').set('Cache-Control', 'private, max-age=300').send(renderPhotoSvg(descriptor))
  }))
  api.get('/fleet', handler((req, res) => {
    const session = req.query.sid ? requireSession(String(req.query.sid)) : null
    res.json({ success: true, data: fleetFor(session, gateway.mode) })
  }))
  mountExtras(api, { staff, handler, ok, gateway })
  api.use('/studio', studioRouter({ gateway }))
  return api
}

export { ACTION }
