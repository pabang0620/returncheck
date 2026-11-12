// Reads the shared demo token in the sandbox (GET /v3/vault/payment-tokens/:id). Prints only the status.
// Usage: node scripts/token-status.js   (PayPal keys and DEMO_VAULT_TOKEN_ID from .env)
import { config } from '../server/config.js'
import { createGateway } from '../server/integrations/gateway.js'

if (!config.paypalClientId) throw new Error('Sandbox keys are not set (or FORCE_MOCK=1).')
const gateway = await createGateway({ config })
const status = await gateway.tokenStatus(config.demoTokenId)
process.stdout.write(`shared demo token ${config.demoTokenId}: ${status}\n`)
