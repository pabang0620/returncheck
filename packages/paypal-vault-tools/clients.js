import { randomBytes } from 'node:crypto'

const SANDBOX = 'https://api-m.sandbox.paypal.com'
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const mockId = (prefix = '', length = 17) => prefix + Array.from(randomBytes(length), (b) => ALNUM[b % ALNUM.length]).join('')

export class PayPalApiError extends Error {
  constructor(status, body) {
    super(`PayPal ${status} ${body?.name || ''} ${body?.details?.[0]?.issue || body?.message || ''}`.trim())
    this.status = status
    this.body = body
  }
}

// Live client: sandbox only. `fetchImpl` is injectable so tests never touch the network.
export function createLiveClient({ clientId, clientSecret, baseUrl = SANDBOX, fetchImpl = fetch }) {
  let token = { value: null, expires: 0 }
  async function accessToken() {
    if (token.value && Date.now() < token.expires - 60000) return token.value
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await fetchImpl(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    if (!res.ok) throw new PayPalApiError(res.status, { name: 'AUTH_FAILED' })
    const data = await res.json()
    token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 }
    return token.value
  }
  return {
    mode: 'sandbox',
    async request(method, path, body, { requestId } = {}) {
      const headers = { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' }
      if (requestId) headers['PayPal-Request-Id'] = requestId
      // PayPal answers POST /v2/checkout/orders with a minimal body by default (no amount, no items), which the
      // server's amount check cannot verify. Found in the sandbox run on 2026-11-12; ask for the full order.
      if (method === 'POST') headers.Prefer = 'return=representation'
      const res = await fetchImpl(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
      const text = await res.text()
      const data = text ? JSON.parse(text) : {}
      if (!res.ok) throw new PayPalApiError(res.status, data)
      return { ...data, http_status: res.status }
    },
  }
}

// Mock client: same response shapes as the documented Vault v3 and Orders v2 answers.
// `revokeToken` simulates the payer removing the merchant in PayPal settings; `loseNextResponse`
// simulates a network drop after PayPal already created the order.
export function createMockClient() {
  const setup = new Map()
  const tokens = new Map()
  const orders = new Map()
  const byRequestId = new Map()
  const state = { loseNext: false, calls: [] }

  function notFound(what) {
    return new PayPalApiError(404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: `${what} not found` }] })
  }

  const client = {
    mode: 'mock',
    state,
    revokeToken(id) { tokens.delete(id) },
    loseNextResponse() { state.loseNext = true },
    seedToken(id, customerId = mockId('CUST', 8)) {
      tokens.set(id, { id, customer: { id: customerId }, payment_source: { paypal: { email_address: 'buyer@example.com', usage_type: 'MERCHANT' } } })
      return id
    },
    async request(method, path, body, { requestId } = {}) {
      state.calls.push({ method, path, requestId })
      if (method === 'POST' && path === '/v3/vault/setup-tokens') {
        const id = mockId('', 8)
        setup.set(id, body)
        return { id, status: 'PAYER_ACTION_REQUIRED', payment_source: { paypal: {} }, links: [{ rel: 'approve', href: `https://www.sandbox.paypal.com/agreements/approve?approval_session_id=${id}`, method: 'GET' }], http_status: 201 }
      }
      if (method === 'POST' && path === '/v3/vault/payment-tokens') {
        const sid = body?.payment_source?.token?.id
        if (!setup.has(sid)) throw notFound('setup token')
        const id = mockId('', 8)
        const token = { id, customer: { id: mockId('CUST', 8) }, payment_source: { paypal: { email_address: 'buyer@example.com', usage_type: 'MERCHANT' } } }
        tokens.set(id, token)
        return { ...token, http_status: 201 }
      }
      if (method === 'GET' && path.startsWith('/v3/vault/payment-tokens/')) {
        const token = tokens.get(decodeURIComponent(path.split('/').pop()))
        if (!token) throw notFound('payment token')
        return { ...token, http_status: 200 }
      }
      if (method === 'GET' && path.startsWith('/v3/vault/payment-tokens?')) {
        const customer = new URLSearchParams(path.split('?')[1]).get('customer_id')
        const list = [...tokens.values()].filter((t) => t.customer.id === customer)
        return { customer: { id: customer }, payment_tokens: list, total_items: list.length, http_status: 200 }
      }
      if (method === 'DELETE' && path.startsWith('/v3/vault/payment-tokens/')) {
        const id = decodeURIComponent(path.split('/').pop())
        if (!tokens.delete(id)) throw notFound('payment token')
        return { http_status: 204 }
      }
      if (method === 'POST' && path === '/v2/checkout/orders') {
        if (requestId && byRequestId.has(requestId)) {
          if (state.loseNext) { state.loseNext = false; throw new Error('network: response lost') }
          return byRequestId.get(requestId)
        }
        const vaultId = body?.payment_source?.paypal?.vault_id
        if (!tokens.has(vaultId)) throw new PayPalApiError(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INVALID_RESOURCE_ID' }] })
        const unit = body.purchase_units[0]
        const order = {
          id: mockId('5O', 15),
          status: 'COMPLETED',
          intent: 'CAPTURE',
          payment_source: { paypal: { email_address: 'buyer@example.com' } },
          purchase_units: [{
            invoice_id: unit.invoice_id,
            items: unit.items,
            amount: unit.amount,
            payments: { captures: [{ id: mockId('CAP', 14), status: 'COMPLETED', amount: unit.amount, invoice_id: unit.invoice_id, final_capture: true }] },
          }],
          http_status: 201,
        }
        orders.set(order.id, order)
        if (requestId) byRequestId.set(requestId, order)
        if (state.loseNext) { state.loseNext = false; throw new Error('network: response lost') }
        return order
      }
      if (method === 'GET' && path.startsWith('/v2/checkout/orders/')) {
        const order = orders.get(path.split('/').pop())
        if (!order) throw notFound('order')
        return order
      }
      throw notFound(`${method} ${path}`)
    },
  }
  return client
}
