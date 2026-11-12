import { createGateway } from '../server/integrations/gateway.js'
import { createSession } from '../server/demo/sessions.js'
import { runInspection, runSettlement } from '../server/domain/inspect.js'
import { renterAnswer, sendLink, staffConfirmItem } from '../server/domain/service.js'

export const TEST_CONFIG = { paymentMode: 'vault', demoTokenId: 'DEMO-SHARED-TOKEN', maxSessions: 200, sessionTtlMs: 3600000, publicUrl: 'http://localhost:3010' }

export async function makeGateway() {
  const gateway = await createGateway({ config: {} })
  gateway.seedDemoToken(TEST_CONFIG.demoTokenId)
  return gateway
}

export async function makeSession(gateway, { setId = 'A', config = TEST_CONFIG, inspect = true } = {}) {
  const session = createSession({ config, setId })
  if (inspect) await runInspection(session, gateway, { live: false })
  return session
}

// Set A after staff review: item 1 (top plate scratch) and item 3 (mount dent) kept; item 2 is pre-existing and dropped.
export async function reachSettlement(gateway, session, { acceptThree = false } = {}) {
  staffConfirmItem(session, 'ITEM-1')
  staffConfirmItem(session, 'ITEM-3')
  sendLink(session)
  renterAnswer(session, 'ITEM-1', 'accept')
  if (acceptThree) renterAnswer(session, 'ITEM-3', 'accept')
  else renterAnswer(session, 'ITEM-3', 'contest', { note: 'This is dust, not a dent', photoNote: 'close-up of the mount' })
  await runSettlement(session, gateway, { live: false })
}

export const pendingOf = (session, type) => session.approvals.find((a) => a.status === 'pending' && a.type === type)
