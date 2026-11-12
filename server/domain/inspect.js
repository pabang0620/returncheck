import { HttpError } from '../http.js'
import { log } from '../demo/sessions.js'
import { runAgent } from '../agent/index.js'

function recordRun(session, phase, outcome) {
  const run = { phase, reply: outcome.reply, events: outcome.events, texts: outcome.texts || [], source: outcome.source, recording: outcome.recording || null, diverged: Boolean(outcome.diverged), offline: Boolean(outcome.offline), fallbackReason: outcome.fallbackReason || null, at: new Date().toISOString() }
  session.agentRuns = { ...(session.agentRuns || {}), [phase]: run }
  return run
}

// Staff photographs the return; Claude compares each zone. The result is draft items for staff to keep or drop.
export async function runInspection(session, gateway, options = {}) {
  if (session.closed) throw new HttpError(409, 'This rental is closed.')
  if (session.claim.items.some((i) => i.status !== 'draft' && i.status !== 'dropped')) {
    throw new HttpError(409, 'Items were already confirmed; the inspection cannot run again.')
  }
  session.inspection = { ...session.inspection, startedAt: session.inspection.startedAt || new Date().toISOString() }
  log(session, 'staff', 'Inspection photos taken, asking Claude to compare each zone.')
  const outcome = await runAgent({ session, gateway, phase: 'inspect', ...options })
  session.inspection = { ...session.inspection, ran: true }
  session.rental = { ...session.rental, status: 'inspected' }
  session.lastAgent = recordRun(session, 'inspect', outcome)
  log(session, 'claude', outcome.reply.split('\n')[0])
  return outcome
}

export async function runSettlement(session, gateway, options = {}) {
  if (!session.linkSent) throw new HttpError(409, 'Send the review link first.')
  const outcome = await runAgent({ session, gateway, phase: 'settle', ...options })
  session.lastAgent = recordRun(session, 'settle', outcome)
  log(session, 'claude', outcome.reply.split('\n')[0])
  return outcome
}

export function closeRental(session) {
  if (session.closed) return session.evidencePack
  if (session.approvals.some((a) => a.status === 'pending')) throw new HttpError(409, 'Approve or reject the pending cards first.')
  const open = session.claim.items.filter((i) => ['draft', 'staff_ok', 'contested', 'accepted', 'staff_upheld', 'reduced'].includes(i.status))
  if (open.length) throw new HttpError(409, `Items still open: ${open.map((i) => i.id).join(', ')}`)
  session.closed = true
  session.rental = { ...session.rental, status: 'closed' }
  session.evidencePack = {
    rentalId: session.rental.id,
    consentAt: session.rental.pickupAt,
    limitCents: session.claim.limitCents,
    photos: session.claim.items.flatMap((i) => i.photoIds),
    renterAnswers: session.claim.items.filter((i) => i.contest || i.status === 'charged').map((i) => ({ itemId: i.id, answer: i.contest ? 'contested' : 'accepted', note: i.contest?.note || '' })),
    approvers: session.approvals.filter((a) => a.approver).map((a) => ({ approval: a.id, type: a.type, approver: a.approver, status: a.status })),
    charges: session.claim.charges.map((c) => ({ orderId: c.orderId, status: c.status, amountCents: c.amountCents })),
  }
  log(session, 'server', 'Rental closed. Evidence pack assembled.')
  return session.evidencePack
}
