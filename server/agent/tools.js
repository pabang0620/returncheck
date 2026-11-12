import { z } from 'zod'
import { toJsonSchema } from '../../packages/paypal-vault-tools/index.js'
import { ACTION, computeAllowedActions } from '../domain/allowedActions.js'
import { requestAction } from '../domain/approvals.js'
import { assertOwner } from '../domain/decisionTable.js'
import { draftFinding } from '../domain/service.js'
import { RATE_CARD, RATE_CODES, ZONE_IDS, ZONES } from '../domain/rateCard.js'
import { STATUS, getItem } from '../domain/claims.js'
import { afterPhotoId, beforePhotoId, closeupPhotoId } from '../demo/photos.js'
import { ASSET_HISTORY } from '../demo/seed.js'
import { log } from '../demo/sessions.js'
import { HttpError } from '../http.js'
import { compareZone } from '../vision/compare.js'

const zone = z.enum(ZONE_IDS)
const rentalId = z.string().min(1).max(32)
const reason = z.string().min(1).max(500)

// Model-facing tools (plan 7-3). Money tools only create approval cards and have no amount field.
export const MODEL_TOOLS = [
  {
    name: 'get_rental',
    description: 'Rental details, zones, rate card (read-only prices), claim items with states, the consent limit, and the list of ALLOWED ACTIONS the code computed for this moment.',
    schema: z.object({ rental_id: rentalId }),
    run: (ctx) => rentalView(ctx.session),
  },
  {
    name: 'get_photo_pair',
    description: 'Check-out and check-in photos for one zone of this rental, and the vision comparison result for the pair (boxes are in original pixels). Also returns the close-up if one was uploaded.',
    schema: z.object({ rental_id: rentalId, zone }),
    run: async (ctx, input) => photoPair(ctx, input.zone),
  },
  {
    name: 'get_asset_history',
    description: 'Past returns of the same asset for one zone: rental id, date, the return photo and the verdict recorded then. Use it to tell whether a mark was already there.',
    schema: z.object({ asset_id: z.string().min(1).max(40), zone }),
    run: (ctx, input) => ({ asset_id: input.asset_id, zone: input.zone, returns: (ASSET_HISTORY[input.asset_id]?.[input.zone] || []).map((h) => ({ rental_id: h.rentalId, returned_at: h.returnedAt, photo_id: h.photoId, verdict_then: h.verdict, mark_visible: h.hasMark })) }),
  },
  {
    name: 'request_closeup',
    description: 'Ask staff for a close-up photo of an uncertain zone. Max 2 per rental. Only offered for zones where the comparison was uncertain.',
    schema: z.object({ zone, reason }),
    run: (ctx, input) => {
      const allowed = computeAllowedActions(ctx.session).find((a) => a.action === ACTION.CLOSEUP)
      if (!allowed || !allowed.zones.includes(input.zone)) throw new HttpError(409, 'A close-up is not allowed for this zone now.')
      ctx.session.inspection.closeupsRequested = [...ctx.session.inspection.closeupsRequested, input.zone]
      log(ctx.session, 'claude', `Asked for a close-up of ${ZONES[input.zone].label}: ${input.reason}`)
      return { requested: true, zone: input.zone, message: 'Staff were asked to upload a close-up. Run the inspection again after it arrives.' }
    },
  },
  {
    name: 'record_finding',
    description: 'Draft one claim item for a zone where the comparison found new damage, by rate card CODE (the server prices it). If the same mark is visible in an earlier return of this asset, set pre_existing true and name that rental in history_ref; the item is then not billed. Never state an amount.',
    schema: z.object({
      zone,
      rate_code: z.enum(RATE_CODES),
      description: z.string().min(1).max(300),
      confidence: z.enum(['high', 'medium', 'low']),
      pre_existing: z.boolean().default(false),
      history_ref: z.string().max(32).optional(),
    }),
    run: (ctx, input) => {
      assertOwner('damage_this_rental', 'model')
      const seen = ctx.session.inspection.zones[input.zone]
      if (!seen || !['damage'].includes(seen.verdict)) throw new HttpError(409, `The comparison for ${input.zone} did not report damage. Call get_photo_pair first.`)
      const asset = ctx.session.rental.gear.find((g) => g.part === ZONES[input.zone].part)
      if (input.pre_existing) {
        const known = (ASSET_HISTORY[asset.assetId]?.[input.zone] || []).some((h) => h.hasMark && h.rentalId === input.history_ref)
        if (!known) throw new HttpError(409, 'pre_existing needs a history_ref that get_asset_history shows with the mark visible.')
      }
      const item = draftFinding(ctx.session, { ...input, box: seen.box })
      log(ctx.session, 'claude', `Drafted ${item.id}: ${item.label} on ${ZONES[item.zone].label}${item.preExisting ? ` (already present in ${item.historyRef}, not billed)` : ''}.`)
      return { item_id: item.id, status: item.status, rate_code: item.rateCode, price_cents_from_rate_card: item.listCents }
    },
  },
  {
    name: 'vault_get_payment_token',
    description: 'State of the PayPal payment token saved for this rental: active, revoked or deleted. Read-only.',
    schema: z.object({ rental_id: rentalId }),
    run: async (ctx) => tokenView(ctx),
  },
  {
    name: 'get_order',
    description: 'Read a PayPal order by id (PayPal Agent Toolkit get_order). Read-only.',
    schema: z.object({ order_id: z.string().min(1).max(40) }),
    run: async (ctx, input) => {
      const known = ctx.session.claim.charges.some((c) => c.orderId === input.order_id)
      if (!known) throw new HttpError(404, 'That order does not belong to this rental.')
      const order = await ctx.gateway.getOrder(input.order_id)
      return { id: order.id, status: order.status, invoice_id: order.purchase_units?.[0]?.invoice_id, amount: order.purchase_units?.[0]?.amount }
    },
  },
  {
    name: 'request_vault_charge',
    description: 'Ask staff to approve charging the renter\'s saved PayPal for accepted items. Creates an approval card only: nothing reaches PayPal until a person approves. There is no amount field: the server sums the rate card prices of the named items. Only works while the allowed actions list contains request_vault_charge.',
    schema: z.object({ claim_id: z.string().min(1).max(40), item_ids: z.array(z.string().min(1).max(20)).min(1).max(10), reason }),
    run: (ctx, input) => approvalResult(requestAction(ctx.session, ACTION.CHARGE, { itemIds: input.item_ids, reason: input.reason, requestedVia: ctx.via }), ctx.session, input.claim_id),
  },
  {
    name: 'request_refund',
    description: 'Ask staff to approve a refund for items staff reduced after they were charged. The server computes the refund as charged minus confirmed. Give only a plain-language reason for the renter. Only offered when the allowed actions list contains request_refund.',
    schema: z.object({ claim_id: z.string().min(1).max(40), item_ids: z.array(z.string().min(1).max(20)).min(1).max(10), reason }),
    run: (ctx, input) => approvalResult(requestAction(ctx.session, ACTION.REFUND, { itemIds: input.item_ids, reason: input.reason, requestedVia: ctx.via }), ctx.session, input.claim_id),
  },
  {
    name: 'request_invoice',
    description: 'Ask staff to approve a PayPal invoice for accepted items. Only offered when the saved PayPal token is revoked or this rental uses invoice mode. Creates an approval card only.',
    schema: z.object({ claim_id: z.string().min(1).max(40), item_ids: z.array(z.string().min(1).max(20)).min(1).max(10), reason }),
    run: (ctx, input) => approvalResult(requestAction(ctx.session, ACTION.INVOICE, { itemIds: input.item_ids, reason: input.reason, requestedVia: ctx.via }), ctx.session, input.claim_id),
  },
  {
    name: 'request_token_delete',
    description: 'Ask staff to approve deleting the saved PayPal token when the rental closes. Not offered for the shared demo token.',
    schema: z.object({ rental_id: rentalId }),
    run: (ctx) => approvalResult(requestAction(ctx.session, ACTION.TOKEN_DELETE, { requestedVia: ctx.via }), ctx.session),
  },
  {
    name: 'hold_for_staff',
    description: 'Put a claim or item on hold for a person, with the reason (for example a contest that disputes the location, or a renter note unrelated to the evidence).',
    schema: z.object({ claim_id: z.string().min(1).max(40), reason }),
    run: (ctx, input) => {
      const itemIds = ctx.session.claim.items.filter((i) => i.status === 'contested').map((i) => i.id)
      ctx.session.holds = [...(ctx.session.holds || []), { reason: input.reason, itemIds, at: new Date().toISOString() }]
      log(ctx.session, 'claude', `Held for staff: ${input.reason}`)
      return { held: true }
    },
  },
  {
    name: 'summarize_contest',
    description: 'Evidence and the renter\'s contest for one item (original zone, box, renter note, renter photo note). Compare the note with the evidence before choosing what to request.',
    schema: z.object({ item_id: z.string().min(1).max(20) }),
    run: (ctx, input) => {
      const item = getItem(ctx.session.claim, input.item_id)
      if (item.status !== STATUS.CONTESTED) throw new HttpError(409, `${item.id} is not contested.`)
      return { item_id: item.id, zone: item.zone, rate_code: item.rateCode, confidence: item.confidence, claude_description: item.description, renter_note: item.contest.note, renter_photo_note: item.contest.photoNote, evidence_photo_ids: item.photoIds }
    },
  },
]

const byName = new Map(MODEL_TOOLS.map((t) => [t.name, t]))

export const modelToolNames = MODEL_TOOLS.map((t) => t.name)

export function claudeTools() {
  return MODEL_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: toJsonSchema(t.schema) }))
}

const short = (v, n = 90) => { const t = typeof v === 'string' ? v : JSON.stringify(v); return t.length > n ? `${t.slice(0, n - 1)}...` : t }

function summarizeResult(name, out) {
  if (!out.ok) return `refused: ${short(out.result.error, 110)}`
  const r = out.result
  if (name === 'get_rental') return `${r.items.length} items, allowed: ${r.allowed_actions.map((a) => a.action).join(', ') || 'nothing'}`
  if (name === 'get_photo_pair') return `${r.zone}: ${r.comparison.verdict}${r.comparison.rateCode ? ` ${r.comparison.rateCode}` : ''} (${r.comparison.source})`
  if (name === 'get_asset_history') return `${r.returns.length} past returns${r.returns.some((h) => h.mark_visible) ? `, mark already visible in ${r.returns.find((h) => h.mark_visible).rental_id}` : ', no earlier mark'}`
  if (name === 'record_finding') return `${r.item_id} ${r.status}, ${r.rate_code} priced by the rate card`
  if (name.startsWith('request_') && r.approval_id) return `approval ${r.approval_id} pending, nothing sent to PayPal`
  return short(r)
}

// One line of the "Claude trace": which tool, with what, and what came back. Shown the same way for live and recorded runs.
export function traceEvent(name, input, out, source) {
  return { tool: name, ok: out.ok, input, source, inputSummary: short(input ?? {}, 80), resultSummary: summarizeResult(name, out), at: new Date().toISOString() }
}

export async function runTool(ctx, name, input) {
  const tool = byName.get(name)
  if (!tool) return { ok: false, result: { error: `Unknown tool ${name}` } }
  try {
    const parsed = tool.schema.parse(input ?? {})
    return { ok: true, result: await tool.run(ctx, parsed) }
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : err.message
    return { ok: false, result: { error: message } }
  }
}

function approvalResult(approval, session, claimId) {
  if (claimId && claimId !== session.claim.id) throw new HttpError(404, 'Unknown claim id.')
  return { approval_id: approval.id, status: 'pending', executed: false, amount_cents_from_rate_card: approval.amountCents, note: 'Approval card created. Nothing was sent to PayPal. A person must approve.' }
}

async function tokenView(ctx) {
  const { session, gateway } = ctx
  if (!session.token) return { status: 'none', note: 'No PayPal saved for this rental (invoice mode).' }
  if (session.token.status === 'deleted') return { status: 'deleted' }
  if (session.token.override === 'revoked') session.token = { ...session.token, status: 'revoked' }
  else if (session.token.status === 'active') {
    const status = await gateway.tokenStatus(session.token.id)
    if (status !== 'active') session.token = { ...session.token, status: 'revoked' }
  }
  return { status: session.token.status, shared_demo_token: session.token.kind === 'demo_shared' }
}

export function rentalView(session) {
  const { rental, claim } = session
  return {
    rental_id: rental.id,
    shop: rental.shop,
    returned_at: rental.returnedAt,
    consent_limit_cents: claim.limitCents,
    claim_id: claim.id,
    gear: rental.gear,
    zones: ZONE_IDS.map((z) => ({ zone: z, label: ZONES[z].label, asset_id: rental.gear.find((g) => g.part === ZONES[z].part).assetId })),
    rate_card: Object.entries(RATE_CARD).map(([code, v]) => ({ code, label: v.label, cents: v.cents })),
    items: claim.items.map((i) => ({ id: i.id, zone: i.zone, rate_code: i.rateCode, status: i.status, list_cents: i.listCents, confirmed_cents: i.confirmedCents, charged_cents: i.chargedCents, refunded_cents: i.refundedCents, contested: i.status === STATUS.CONTESTED, pre_existing: i.preExisting, history_ref: i.historyRef })),
    allowed_actions: computeAllowedActions(session),
    pending_approvals: session.approvals.filter((a) => a.status === 'pending').map((a) => ({ id: a.id, type: a.type, item_ids: a.itemIds })),
  }
}

async function photoPair(ctx, zoneId) {
  const { session } = ctx
  const useCloseup = session.inspection.closeupsUploaded.includes(zoneId)
  const uploaded = (kind) => session.uploads?.[`${kind}:${zoneId}`]
  const get = (id, kind) => {
    const up = uploaded(kind)
    return up ? { ...session.photos[id], mediaType: up.mediaType, data: up.data, width: up.width, height: up.height, sharpness: up.sharpness } : { ...session.photos[id], mediaType: null, data: null }
  }
  const photos = {
    before: get(beforePhotoId(session.setId, zoneId), 'before'),
    after: get(afterPhotoId(session.setId, zoneId), 'after'),
    closeup: useCloseup ? get(closeupPhotoId(session.setId, zoneId), 'closeup') : null,
  }
  const result = await compareZone({ setId: session.setId, zone: zoneId, zoneLabel: ZONES[zoneId].label, photos, useCloseup, anthropic: ctx.anthropic || null, model: ctx.model })
  session.inspection.zones = { ...session.inspection.zones, [zoneId]: result }
  return {
    zone: zoneId,
    before: { photo_id: photos.before.id, url: `/api/photos/${session.id}/${photos.before.id}.svg` },
    after: { photo_id: photos.after.id, url: `/api/photos/${session.id}/${photos.after.id}.svg` },
    closeup: photos.closeup ? { photo_id: photos.closeup.id, url: `/api/photos/${session.id}/${photos.closeup.id}.svg` } : null,
    comparison: result,
  }
}
