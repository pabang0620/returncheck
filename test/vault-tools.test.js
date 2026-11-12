import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createLiveClient, createMockClient, createVaultTools, readOnlyVaultTools, vaultToolNames, VAULT_TOOLS } from '../packages/paypal-vault-tools/index.js'

const tokenResponse = { access_token: 'tok', expires_in: 3600 }

function fakeFetch(log, reply = {}) {
  return async (url, init) => {
    log.push({ url, init })
    if (url.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify(tokenResponse), { status: 200 })
    return new Response(JSON.stringify(reply), { status: 201 })
  }
}

describe('paypal-vault-tools', () => {
  it('has the six Vault tools in toolkit shape', () => {
    assert.deepEqual(vaultToolNames, ['vault_create_setup_token', 'vault_create_payment_token', 'vault_get_payment_token', 'vault_list_customer_tokens', 'vault_charge_token', 'vault_delete_payment_token'])
    for (const t of VAULT_TOOLS) {
      assert.equal(t.method, t.name)
      assert.equal(typeof t.description, 'string')
      assert.equal(typeof t.parameters.parse, 'function')
      assert.equal(typeof t.actions.vault, 'object')
      assert.equal(typeof t.execute, 'function')
    }
    assert.deepEqual(readOnlyVaultTools.map((t) => t.name), ['vault_get_payment_token', 'vault_list_customer_tokens'])
  })

  it('exports toolkit-compatible OpenAI and Claude tool lists', () => {
    const tools = createVaultTools({ client: createMockClient() })
    assert.equal(tools.toOpenAITools()[0].type, 'function')
    assert.ok(tools.toOpenAITools()[4].function.parameters.properties.vault_id)
    assert.ok(tools.toClaudeTools()[4].input_schema.required.includes('request_id'))
  })

  it('sends the documented setup token body to the sandbox host', async () => {
    const log = []
    const client = createLiveClient({ clientId: 'a', clientSecret: 'b', fetchImpl: fakeFetch(log, { id: 'ST1', status: 'PAYER_ACTION_REQUIRED' }) })
    const tools = createVaultTools({ client })
    await tools.handleToolCall('vault_create_setup_token', { description: 'ReturnCheck: rental R-1042 only', return_url: 'https://x.test/r', cancel_url: 'https://x.test/c' })
    const call = log.find((l) => l.url.includes('/v3/vault/setup-tokens'))
    assert.match(call.url, /^https:\/\/api-m\.sandbox\.paypal\.com\//)
    const body = JSON.parse(call.init.body)
    assert.equal(body.payment_source.paypal.usage_type, 'MERCHANT')
    assert.equal(body.payment_source.paypal.usage_pattern, 'UNSCHEDULED_POSTPAID')
    assert.equal(body.payment_source.paypal.customer_type, 'CONSUMER')
  })

  it('charges with vault_id, items, invoice_id and a Request-Id header', async () => {
    const log = []
    const client = createLiveClient({ clientId: 'a', clientSecret: 'b', fetchImpl: fakeFetch(log, { id: 'O1', status: 'COMPLETED' }) })
    const tools = createVaultTools({ client })
    await tools.handleToolCall('vault_charge_token', {
      vault_id: 'V1', invoice_id: 'CLM-1042-1', request_id: 'CLM-1042-1-r1',
      items: [{ name: 'Top plate scratch (SCR-S)', quantity: '1', unit_amount: { currency_code: 'USD', value: '35.00' } }],
      amount: { currency_code: 'USD', value: '35.00' },
    })
    const call = log.find((l) => l.url.endsWith('/v2/checkout/orders'))
    assert.equal(call.init.headers['PayPal-Request-Id'], 'CLM-1042-1-r1')
    assert.equal(call.init.headers.Prefer, 'return=representation')
    const body = JSON.parse(call.init.body)
    assert.equal(body.intent, 'CAPTURE')
    assert.equal(body.payment_source.paypal.vault_id, 'V1')
    assert.equal(body.payment_source.paypal.stored_credential, undefined)
    assert.equal(body.purchase_units[0].invoice_id, 'CLM-1042-1')
    assert.equal(body.purchase_units[0].amount.breakdown.item_total.value, '35.00')
  })

  it('adds stored_credential only when asked', async () => {
    const log = []
    const client = createLiveClient({ clientId: 'a', clientSecret: 'b', fetchImpl: fakeFetch(log, { id: 'O1' }) })
    const tools = createVaultTools({ client })
    await tools.handleToolCall('vault_charge_token', { vault_id: 'V1', invoice_id: 'I', request_id: 'R', with_stored_credential: true, items: [{ name: 'x', quantity: '1', unit_amount: { currency_code: 'USD', value: '1.00' } }], amount: { currency_code: 'USD', value: '1.00' } })
    const body = JSON.parse(log.find((l) => l.url.endsWith('/v2/checkout/orders')).init.body)
    assert.deepEqual(body.payment_source.paypal.stored_credential, { payment_initiator: 'MERCHANT', usage: 'SUBSEQUENT', usage_pattern: 'UNSCHEDULED_POSTPAID' })
  })

  it('order items sum equals order amount', async () => {
    const client = createMockClient()
    client.seedToken('V1')
    const tools = createVaultTools({ client })
    const item = (v) => ({ name: 'x', quantity: '1', unit_amount: { currency_code: 'USD', value: v } })
    await assert.rejects(() => tools.handleToolCall('vault_charge_token', { vault_id: 'V1', invoice_id: 'I', request_id: 'R', items: [item('35.00'), item('12.00')], amount: { currency_code: 'USD', value: '40.00' } }), /does not equal/)
    const ok = await tools.handleToolCall('vault_charge_token', { vault_id: 'V1', invoice_id: 'I', request_id: 'R2', items: [item('35.00'), item('12.00')], amount: { currency_code: 'USD', value: '47.00' } })
    assert.equal(ok.status, 'COMPLETED')
  })

  it('mock: unknown token cannot be charged, deleted token answers 404', async () => {
    const client = createMockClient()
    const tools = createVaultTools({ client })
    const line = { name: 'x', quantity: '1', unit_amount: { currency_code: 'USD', value: '1.00' } }
    await assert.rejects(() => tools.handleToolCall('vault_charge_token', { vault_id: 'NOPE', invoice_id: 'I', request_id: 'R', items: [line], amount: { currency_code: 'USD', value: '1.00' } }), (e) => e.status === 422)
    client.seedToken('V2')
    assert.equal((await tools.handleToolCall('vault_delete_payment_token', { payment_token_id: 'V2' })).http_status, 204)
    await assert.rejects(() => tools.handleToolCall('vault_get_payment_token', { payment_token_id: 'V2' }), (e) => e.status === 404)
  })
})
