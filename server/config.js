import 'dotenv/config'

const forceMock = process.env.FORCE_MOCK === '1'
const accountMode = !forceMock && process.env.LLM_BACKEND === 'account'
const port = Number(process.env.PORT || 3010)
const publicUrl = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, '')

export const config = {
  port,
  publicUrl,
  anthropicKey: forceMock || accountMode ? '' : process.env.ANTHROPIC_API_KEY || '',
  // 'account' = local development through the Claude Agent SDK and the developer's Claude Code login (never an API key).
  llmBackend: accountMode ? 'account' : 'api',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  paypalClientId: forceMock ? '' : process.env.PAYPAL_CLIENT_ID || '',
  paypalClientSecret: forceMock ? '' : process.env.PAYPAL_CLIENT_SECRET || '',
  // Pre-saved sandbox payment token shared by all judge sessions. It can be charged, never deleted.
  demoTokenId: process.env.DEMO_VAULT_TOKEN_ID || 'DEMO-SHARED-TOKEN',
  // 'vault' = saved PayPal token (default). 'invoice' = plan 6-5 fallback when Vault is not available.
  paymentMode: process.env.PAYMENT_MODE === 'invoice' ? 'invoice' : 'vault',
  maxSessions: Number(process.env.MAX_SESSIONS || 300),
  sessionTtlMs: Number(process.env.SESSION_TTL_MS || 6 * 3600 * 1000),
  studioLicenseKey: process.env.AG_STUDIO_LICENSE_KEY || '',
  testBuyer: process.env.SANDBOX_BUYER_EMAIL ? { email: process.env.SANDBOX_BUYER_EMAIL } : null,
}

export const modes = {
  llm: config.anthropicKey || config.llmBackend === 'account' ? 'live' : 'mock',
  llmLabel: config.llmBackend === 'account' ? 'Claude Sonnet (local account)' : config.anthropicKey ? 'Claude (API)' : 'none',
  paypal: config.paypalClientId && config.paypalClientSecret ? 'sandbox' : 'mock',
}
