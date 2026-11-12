import { HttpError } from '../http.js'
import { log } from '../demo/sessions.js'
import { toDecimal } from './money.js'

// "Save PayPal yourself": a real Vault v3 setup/payment token pair for this session only.
export async function startSave(session, gateway, config) {
  if (session.rental.mode === 'invoice') throw new HttpError(409, 'This shop runs in invoice mode: no PayPal is saved at pickup.')
  const limit = toDecimal(session.claim.limitCents).replace(/\.00$/, '')
  const setup = await gateway.vaultTool('vault_create_setup_token', {
    usage_type: 'MERCHANT',
    customer_type: 'CONSUMER',
    usage_pattern: 'UNSCHEDULED_POSTPAID',
    description: `ReturnCheck: damage charges for rental ${session.rental.id} only, up to $${limit}, after your review`,
    return_url: `${config.publicUrl}/api/s/${session.id}/token/return`,
    cancel_url: `${config.publicUrl}/judge/${session.id}`,
  })
  const approve = setup.links?.find((l) => l.rel === 'approve')?.href
  const approveUrl = gateway.mode === 'mock' ? `${config.publicUrl}/mock-paypal/approve?sid=${session.id}&setup=${setup.id}` : approve
  session.pendingSetup = { id: setup.id, startedAt: new Date().toISOString() }
  log(session, 'renter', 'Started saving PayPal for this rental.')
  return { setupTokenId: setup.id, approveUrl }
}

export async function finishSave(session, gateway, setupTokenId) {
  if (!session.pendingSetup || session.pendingSetup.id !== setupTokenId) throw new HttpError(403, 'Unknown setup token for this rental.')
  const token = await gateway.vaultTool('vault_create_payment_token', { setup_token_id: setupTokenId })
  session.token = { id: token.id, kind: 'own', status: 'active', customerId: token.customer?.id, savedAt: new Date().toISOString() }
  session.pendingSetup = null
  log(session, 'renter', 'Saved PayPal for this rental (your own sandbox token, deletable).')
  return session.token
}

// Demo helper for the renter side: pretend the payer removed ReturnCheck in PayPal settings.
// A shared token is never touched in PayPal: the removal is simulated for this session only.
export async function simulateRevoke(session, gateway) {
  if (!session.token || session.token.status !== 'active') throw new HttpError(409, 'No active saved PayPal.')
  if (session.token.kind === 'demo_shared') {
    session.token = { ...session.token, status: 'revoked', override: 'revoked' }
  } else if (gateway.client.revokeToken) {
    gateway.client.revokeToken(session.token.id)
    session.token = { ...session.token, status: 'revoked' }
  } else {
    throw new HttpError(409, 'Remove ReturnCheck in your PayPal sandbox settings, then reload.')
  }
  log(session, 'renter', 'Removed ReturnCheck from PayPal (simulated).')
}
