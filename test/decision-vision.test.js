import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DECISIONS, OWNER, assertOwner, decisionsOwnedBy, ownerOf } from '../server/domain/decisionTable.js'
import { compareZone, buildVisionRequest } from '../server/vision/compare.js'
import { checkPhotoQuality, fitForModel, scaleBoxToOriginal } from '../server/vision/evidence.js'
import { photoDescriptor } from '../server/demo/seed.js'
import { MODEL_TOOLS } from '../server/agent/tools.js'
import { RATE_CARD, priceOf } from '../server/domain/rateCard.js'
import { toDecimal } from '../server/domain/money.js'

const photos = (set, zone, closeup = false) => ({
  before: photoDescriptor(set, 'before', zone),
  after: photoDescriptor(set, 'after', zone),
  closeup: closeup ? photoDescriptor(set, 'closeup', zone) : null,
})

describe('decision table', () => {
  it('amounts and branches belong to code, comparison judgment to the model, approvals to people', () => {
    assert.equal(ownerOf('amount'), OWNER.CODE)
    assert.equal(ownerOf('allowed_actions'), OWNER.CODE)
    assert.equal(ownerOf('token_branch'), OWNER.CODE)
    assert.equal(ownerOf('refund_branch'), OWNER.CODE)
    assert.equal(ownerOf('damage_this_rental'), OWNER.MODEL)
    assert.equal(ownerOf('charge_vs_hold'), OWNER.MODEL)
    assert.equal(ownerOf('approve_money_action'), OWNER.HUMAN)
    assert.throws(() => assertOwner('amount', OWNER.MODEL), /belongs to code/)
    assert.throws(() => ownerOf('nope'))
    assert.ok(decisionsOwnedBy(OWNER.MODEL).length >= 4)
    assert.equal(new Set(DECISIONS.map((d) => d.id)).size, DECISIONS.length)
  })

  it('no model tool has an amount parameter and prices only come from the rate card', () => {
    for (const t of MODEL_TOOLS) assert.doesNotMatch(Object.keys(t.schema.shape).join(','), /amount|price|cents|total/i, t.name)
    assert.equal(priceOf('SCR-S'), 3500)
    assert.equal(toDecimal(RATE_CARD['LNS-F'].cents), '150.00')
  })
})

describe('vision comparison', () => {
  it('returns seeded results for preloaded pairs with boxes mapped to original pixels', async () => {
    const r = await compareZone({ setId: 'A', zone: 'top_plate', zoneLabel: 'Top plate', photos: photos('A', 'top_plate') })
    assert.equal(r.source, 'seeded')
    assert.equal(r.verdict, 'damage')
    assert.deepEqual(r.box, { x: 280, y: 184, w: 160, h: 32 })
  })

  it('set B front element is uncertain until the close-up arrives', async () => {
    const first = await compareZone({ setId: 'B', zone: 'lens_front', zoneLabel: 'Lens front element', photos: photos('B', 'lens_front') })
    assert.equal(first.verdict, 'uncertain')
    const second = await compareZone({ setId: 'B', zone: 'lens_front', zoneLabel: 'Lens front element', photos: photos('B', 'lens_front', true), useCloseup: true })
    assert.equal(second.verdict, 'damage')
    assert.equal(second.rateCode, 'LNS-F')
  })

  it('does not judge photos that are too small or blurry', async () => {
    const tiny = { ...photos('A', 'top_plate'), after: { ...photoDescriptor('A', 'after', 'top_plate'), width: 120, height: 90 } }
    const r = await compareZone({ setId: 'A', zone: 'top_plate', zoneLabel: 'Top plate', photos: tiny })
    assert.equal(r.verdict, 'unreadable')
    assert.match(r.note, /too small or blurry for zone Top plate\. Retake\./)
    assert.equal(checkPhotoQuality({ width: 800, height: 600, sharpness: 0.1 }).reason, 'blurry')
  })

  it('live path sends shrunk raster images with the oversized guard and maps the box back', async () => {
    const sentRequests = []
    const anthropic = { messages: { create: async (req) => { sentRequests.push(req); return { content: [{ type: 'tool_use', name: 'report_zone', input: { verdict: 'damage', confidence: 'high', rate_code: 'SCR-S', box: { x: 100, y: 50, w: 200, h: 20 }, note: 'scratch' } }] } } } }
    const raster = (id) => ({ id, width: 3136, height: 2352, mediaType: 'image/jpeg', data: 'AAAA' })
    const r = await compareZone({ setId: 'A', zone: 'top_plate', zoneLabel: 'Top plate', photos: { before: raster('b'), after: raster('a'), closeup: null }, anthropic })
    assert.equal(r.source, 'claude')
    assert.equal(sentRequests.length, 1)
    const images = sentRequests[0].messages[0].content.filter((b) => b.type === 'image')
    assert.equal(images.length, 2)
    assert.ok(images.every((b) => b.oversized_image === 'error'))
    assert.deepEqual(fitForModel(3136, 2352), { width: 1568, height: 1176, scale: 0.5 })
    assert.deepEqual(r.box, { x: 200, y: 100, w: 400, h: 40 })
    assert.equal(sentRequests[0].tool_choice, undefined)
    assert.match(sentRequests[0].system, /You must answer by calling the tool report_zone\./)
  })

  it('buildVisionRequest never asks the model for a price', () => {
    const req = buildVisionRequest({ model: 'm', zone: 'z', zoneLabel: 'Z', before: { mediaType: 'image/png', data: 'a' }, after: { mediaType: 'image/png', data: 'b', sentWidth: 10, sentHeight: 10 } })
    assert.doesNotMatch(JSON.stringify(req.tools), /price|amount|cents/i)
    assert.deepEqual(scaleBoxToOriginal({ x: 1, y: 1, w: 5000, h: 5000 }, { width: 10, height: 10 }, { width: 100, height: 100 }), { x: 10, y: 10, w: 90, h: 90 })
  })
})
