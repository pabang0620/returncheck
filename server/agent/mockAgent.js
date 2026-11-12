import { ACTION } from '../domain/allowedActions.js'
import { ZONE_IDS } from '../domain/rateCard.js'
import { runTool, traceEvent } from './tools.js'

// Scripted stand-in for the Claude loop, used only when no model is available and no recorded real run matches
// the session state. It calls the same tools through the same executor, so permissions, allowed actions and
// approval cards behave exactly as with the live model. The screen labels it "Scripted stand-in", never a model.
export async function runMockAgent(ctx, phase) {
  const events = []
  const call = async (name, input) => {
    const out = await runTool(ctx, name, input)
    events.push(traceEvent(name, input, out, 'scripted'))
    return out
  }
  const reply = phase === 'inspect' ? await inspect(ctx, call) : await settle(ctx, call)
  return { reply, events, source: 'scripted' }
}

async function inspect(ctx, call) {
  const rental = (await call('get_rental', { rental_id: ctx.session.rental.id })).result
  const lines = []
  for (const zone of ZONE_IDS) {
    const pair = await call('get_photo_pair', { rental_id: rental.rental_id, zone })
    const v = pair.result.comparison
    if (!pair.ok) continue
    if (v.verdict === 'unreadable') { lines.push(`${zone}: ${v.note}`); continue }
    if (v.verdict === 'uncertain') {
      const asked = await call('request_closeup', { zone, reason: v.note })
      lines.push(asked.ok ? `${zone}: unclear, close-up requested.` : `${zone}: unclear (${asked.result.error}).`)
      continue
    }
    if (v.verdict !== 'damage') continue
    const asset = rental.zones.find((z) => z.zone === zone).asset_id
    const history = (await call('get_asset_history', { asset_id: asset, zone })).result
    const seen = history.returns.find((r) => r.mark_visible)
    const out = await call('record_finding', { zone, rate_code: v.rateCode, description: v.note, confidence: v.confidence, pre_existing: Boolean(seen), history_ref: seen?.rental_id })
    if (out.ok) lines.push(seen ? `${zone}: mark already present in ${seen.rental_id}, not billed.` : `${zone}: new damage drafted (${v.rateCode}).`)
  }
  return lines.length ? lines.join('\n') : 'No new damage found in any zone.'
}

async function settle(ctx, call) {
  const rental = (await call('get_rental', { rental_id: ctx.session.rental.id })).result
  const token = (await call('vault_get_payment_token', { rental_id: rental.rental_id })).result
  const notes = []
  for (const item of rental.items.filter((i) => i.contested)) {
    const contest = await call('summarize_contest', { item_id: item.id })
    if (!contest.ok) continue
    const view = contest.result
    const noteText = view.renter_note ? `renter says "${view.renter_note}"` : 'renter gave no explanation'
    const reason = `${item.id} (${view.zone.replaceAll('_', ' ')}): ${noteText}${view.renter_photo_note ? ` with a photo (${view.renter_photo_note})` : ''}. The comparison confidence was ${view.confidence}. Needs a person to compare the two photos.`
    await call('hold_for_staff', { claim_id: rental.claim_id, reason })
    notes.push(`${item.id} is held for staff review.`)
  }
  const allowed = new Map(rental.allowed_actions.map((a) => [a.action, a]))
  if (allowed.has(ACTION.CHARGE)) {
    const a = allowed.get(ACTION.CHARGE)
    const out = await call('request_vault_charge', { claim_id: rental.claim_id, item_ids: a.itemIds, reason: `Renter accepted ${a.itemIds.join(', ')}. Contested items are not included.` })
    notes.push(out.ok ? 'Charge request is waiting for staff approval.' : `Charge request refused: ${out.result.error}`)
  } else if (allowed.has(ACTION.INVOICE)) {
    const a = allowed.get(ACTION.INVOICE)
    const out = await call('request_invoice', { claim_id: rental.claim_id, item_ids: a.itemIds, reason: token.status === 'revoked' ? 'The renter removed the saved PayPal, so an invoice is the only way to bill the accepted items.' : 'This rental bills by invoice.' })
    notes.push(out.ok ? 'Invoice request is waiting for staff approval.' : `Invoice request refused: ${out.result.error}`)
  } else if (token.status === 'revoked') {
    notes.push('The saved PayPal was removed and nothing payable is left to invoice.')
  }
  if (allowed.has(ACTION.REFUND)) {
    const a = allowed.get(ACTION.REFUND)
    const why = rental.items.filter((i) => a.itemIds.includes(i.id)).map((i) => i.id).join(', ')
    const out = await call('request_refund', { claim_id: rental.claim_id, item_ids: a.itemIds, reason: `After a second look at the photos, staff lowered ${why}. The difference goes back to your PayPal.` })
    notes.push(out.ok ? 'Refund request is waiting for staff approval.' : `Refund request refused: ${out.result.error}`)
  }
  if (allowed.has(ACTION.TOKEN_DELETE)) {
    const out = await call('request_token_delete', { rental_id: rental.rental_id })
    notes.push(out.ok ? 'Request to delete the saved PayPal is waiting for staff approval.' : `Delete request refused: ${out.result.error}`)
  }
  return notes.length ? notes.join('\n') : 'Nothing to request right now.'
}
