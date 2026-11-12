import express from 'express'
import { z } from 'zod'
import { checkDisputes, simulateDispute } from '../domain/disputes.js'
import { renderEvidenceHtml } from '../domain/evidenceHtml.js'
import { inspectRaster } from '../domain/rasterPhoto.js'
import { ZONE_IDS } from '../domain/rateCard.js'
import { log } from '../demo/sessions.js'
import { HttpError, parse } from '../http.js'

const MAX_PHOTO_BASE64 = 2_800_000
const uploadSchema = z.object({ kind: z.enum(['before', 'after', 'closeup']), mediaType: z.enum(['image/jpeg', 'image/png']), data: z.string().min(32).max(MAX_PHOTO_BASE64).regex(/^[A-Za-z0-9+/=]+$/) })

// Real photo upload (JPEG or PNG) for one zone, and the readable evidence page. Both are staff only.
export function mountExtras(api, { staff, handler, ok, gateway }) {
  api.post('/s/:sid/photos/:zone', staff, express.json({ limit: '3mb' }), handler((req, res) => {
    const zone = parse(z.enum(ZONE_IDS), req.params.zone)
    const body = parse(uploadSchema, req.body)
    const raster = inspectRaster(body.data, body.mediaType)
    req.session.uploads = { ...(req.session.uploads || {}), [`${body.kind}:${zone}`]: { ...raster, data: body.data, sharpness: 1, uploadedAt: new Date().toISOString() } }
    log(req.session, 'staff', `Uploaded a ${raster.mediaType} ${body.kind} photo (${raster.width}x${raster.height}) for ${zone}.`)
    ok(res, req.session, 'staff', { photo: { zone, kind: body.kind, mediaType: raster.mediaType, width: raster.width, height: raster.height } })
  }))
  // Staff-only view of a photo the staff uploaded. The bytes were checked by magic number on upload.
  api.get('/s/:sid/uploads/:kind/:zone', staff, handler((req, res) => {
    const kind = parse(z.enum(['before', 'after', 'closeup']), req.params.kind)
    const zone = parse(z.enum(ZONE_IDS), req.params.zone)
    const up = req.session.uploads?.[`${kind}:${zone}`]
    if (!up) throw new HttpError(404, 'No uploaded photo for this zone.')
    res.type(up.mediaType).set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }).send(Buffer.from(up.data, 'base64'))
  }))
  // Dispute watch: read only. The simulate route works on the mock gateway only.
  api.post('/s/:sid/disputes/check', staff, handler(async (req, res) => { await checkDisputes(req.session, gateway); ok(res, req.session, 'staff') }))
  api.post('/s/:sid/disputes/simulate', staff, handler((req, res) => { simulateDispute(req.session, gateway); ok(res, req.session, 'staff') }))
  api.get('/s/:sid/evidence.html', staff, handler((req, res) => {
    if (!req.session.closed) throw new HttpError(409, 'Close the rental first.')
    res.type('html').send(renderEvidenceHtml(req.session))
  }))
}
