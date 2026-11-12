import { z } from 'zod'
import { RATE_CODES } from '../domain/rateCard.js'
import { CLOSEUP_FIXTURES, MODEL_VIEW, VISION_FIXTURES } from './fixtures.js'
import { createRequiringTool } from '../llm/requiredTool.js'
import { checkPhotoQuality, fitForModel, scaleBoxToOriginal } from './evidence.js'

const boxSchema = z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().positive(), h: z.number().positive() })

export const zoneReportSchema = z.object({
  verdict: z.enum(['damage', 'none', 'uncertain']),
  confidence: z.enum(['high', 'medium', 'low']),
  rate_code: z.enum(RATE_CODES).optional(),
  box: boxSchema.optional(),
  note: z.string().max(400),
})

// Claude vision request for one zone (plan 7-2). Photos must be raster JPEG or PNG records:
// { mediaType, data (base64), width, height }. Images are sent already shrunk, with the oversized guard on.
export function buildVisionRequest({ model, zone, zoneLabel, before, after, closeup }) {
  const imageBlock = (photo) => ({
    type: 'image',
    source: { type: 'base64', media_type: photo.mediaType, data: photo.data },
    oversized_image: 'error',
  })
  const content = [
    { type: 'text', text: `Zone: ${zoneLabel}. First image: check-out photo. Second image: check-in photo.${closeup ? ' Third image: close-up of the suspect spot.' : ''} Report only damage that is new in the check-in photo. Box coordinates are in pixels of the image you were sent (${after.sentWidth}x${after.sentHeight}). Coordinates are approximate.` },
    imageBlock(before),
    imageBlock(after),
    ...(closeup ? [imageBlock(closeup)] : []),
  ]
  return {
    model,
    max_tokens: 1024,
    system: 'You compare two photos of the same rental camera zone and report visible new damage. If the photo is too small, blurry or ambiguous, answer "uncertain". You never state a price and you do not judge whether an image is fake.',
    tools: [{
      name: 'report_zone',
      description: 'Report the result for this zone',
      input_schema: { type: 'object', properties: { verdict: { enum: ['damage', 'none', 'uncertain'] }, confidence: { enum: ['high', 'medium', 'low'] }, rate_code: { enum: RATE_CODES }, box: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, required: ['x', 'y', 'w', 'h'] }, note: { type: 'string' } }, required: ['verdict', 'confidence', 'note'] },
    }],
    messages: [{ role: 'user', content }],
  }
}

function isRaster(photo) {
  return Boolean(photo && photo.data && ['image/jpeg', 'image/png'].includes(photo.mediaType))
}

function withOriginalBox(report, original) {
  if (!report.box) return report
  return { ...report, box: scaleBoxToOriginal(report.box, MODEL_VIEW, original) }
}

// One zone. Live call only when an Anthropic client is given and all photos are raster records;
// otherwise the seeded result written for the drawn demo photos is returned (not model output). Both carry `source`.
export async function compareZone({ setId, zone, zoneLabel, photos, useCloseup = false, anthropic = null, model = 'claude-sonnet-5-5' }) {
  const { before, after, closeup } = photos
  const quality = checkPhotoQuality({ width: after.width, height: after.height, sharpness: after.sharpness })
  if (!quality.ok) {
    return { zone, verdict: 'unreadable', quality, source: 'quality-check', note: `Photo too small or blurry for zone ${zoneLabel}. Retake.` }
  }
  const original = { width: after.width, height: after.height }

  if (anthropic && isRaster(before) && isRaster(after) && (!useCloseup || isRaster(closeup))) {
    try {
      const sent = fitForModel(after.width, after.height)
      const request = buildVisionRequest({ model, zone, zoneLabel, before, after: { ...after, sentWidth: sent.width, sentHeight: sent.height }, closeup: useCloseup ? closeup : null })
      const response = await createRequiringTool(anthropic, request, 'report_zone')
      if (!response) throw new Error('Claude did not call report_zone')
      const block = response.content.find((b) => b.type === 'tool_use' && b.name === 'report_zone')
      if (!block) throw new Error('Claude returned no zone report')
      const parsed = zoneReportSchema.parse(block.input)
      const report = { zone, verdict: parsed.verdict, confidence: parsed.confidence, rateCode: parsed.rate_code, box: parsed.box, note: parsed.note, source: 'claude' }
      return report.box ? { ...report, box: scaleBoxToOriginal(report.box, sent, original) } : report
    } catch {
      // The model did not answer for this zone: use the seeded result below, labelled seeded (never as the model).
    }
  }

  const recorded = useCloseup ? CLOSEUP_FIXTURES[setId]?.[zone] : VISION_FIXTURES[setId]?.[zone]
  const base = recorded || VISION_FIXTURES[setId]?.[zone]
  if (!base) return { zone, verdict: 'none', confidence: 'low', note: 'No seeded result for this zone', source: 'seeded' }
  return { zone, ...withOriginalBox(base, original), source: 'seeded', quality }
}
