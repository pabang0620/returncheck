import {
  chargeTokenSchema,
  createPaymentTokenSchema,
  createSetupTokenSchema,
  deletePaymentTokenSchema,
  getPaymentTokenSchema,
  listCustomerTokensSchema,
} from './schemas.js'

const cents = (value) => Math.round(Number(value) * 100)

// Same fields as a @paypal/agent-toolkit Tool (method, name, description, parameters, actions)
// plus `execute(client, args)`. Read-only tools are flagged so a model can be given only those.
export const VAULT_TOOLS = [
  {
    method: 'vault_create_setup_token',
    name: 'vault_create_setup_token',
    description: 'Start saving PayPal for later use by this merchant (POST /v3/vault/setup-tokens). Returns the approve link the payer opens.',
    parameters: createSetupTokenSchema,
    actions: { vault: { createSetupToken: true } },
    readOnly: false,
    execute: (client, a) => client.request('POST', '/v3/vault/setup-tokens', {
      ...(a.customer_id ? { customer: { id: a.customer_id } } : {}),
      payment_source: {
        paypal: {
          usage_type: a.usage_type,
          customer_type: a.customer_type,
          usage_pattern: a.usage_pattern,
          description: a.description,
          experience_context: { return_url: a.return_url, cancel_url: a.cancel_url },
        },
      },
    }),
  },
  {
    method: 'vault_create_payment_token',
    name: 'vault_create_payment_token',
    description: 'Turn an approved setup token into a saved payment token (POST /v3/vault/payment-tokens).',
    parameters: createPaymentTokenSchema,
    actions: { vault: { createPaymentToken: true } },
    readOnly: false,
    execute: (client, a) => client.request('POST', '/v3/vault/payment-tokens', {
      payment_source: { token: { id: a.setup_token_id, type: 'SETUP_TOKEN' } },
    }),
  },
  {
    method: 'vault_get_payment_token',
    name: 'vault_get_payment_token',
    description: 'Read a saved payment token (GET /v3/vault/payment-tokens/{id}). A removed or revoked token answers with an error.',
    parameters: getPaymentTokenSchema,
    actions: { vault: { getPaymentToken: true } },
    readOnly: true,
    execute: (client, a) => client.request('GET', `/v3/vault/payment-tokens/${encodeURIComponent(a.payment_token_id)}`),
  },
  {
    method: 'vault_list_customer_tokens',
    name: 'vault_list_customer_tokens',
    description: 'List the payment tokens saved for one customer (GET /v3/vault/payment-tokens?customer_id=).',
    parameters: listCustomerTokensSchema,
    actions: { vault: { listCustomerTokens: true } },
    readOnly: true,
    execute: (client, a) => client.request('GET', `/v3/vault/payment-tokens?customer_id=${encodeURIComponent(a.customer_id)}&page_size=${a.page_size}`),
  },
  {
    method: 'vault_charge_token',
    name: 'vault_charge_token',
    description: 'Charge a saved token with an Orders v2 CAPTURE order (POST /v2/checkout/orders). The caller supplies the amount. Money tool: never hand it to a model.',
    parameters: chargeTokenSchema,
    actions: { vault: { chargeToken: true } },
    readOnly: false,
    execute: (client, a) => {
      const sum = a.items.reduce((total, item) => total + cents(item.unit_amount.value) * Number(item.quantity), 0)
      if (sum !== cents(a.amount.value)) throw new Error(`Order items sum ${sum} cents does not equal the order amount ${cents(a.amount.value)} cents`)
      const paypal = { vault_id: a.vault_id }
      if (a.with_stored_credential) {
        paypal.stored_credential = { payment_initiator: 'MERCHANT', usage: 'SUBSEQUENT', usage_pattern: 'UNSCHEDULED_POSTPAID' }
      }
      return client.request('POST', '/v2/checkout/orders', {
        intent: 'CAPTURE',
        purchase_units: [{
          invoice_id: a.invoice_id,
          items: a.items,
          amount: { ...a.amount, breakdown: { item_total: a.amount } },
        }],
        payment_source: { paypal },
      }, { requestId: a.request_id })
    },
  },
  {
    method: 'vault_delete_payment_token',
    name: 'vault_delete_payment_token',
    description: 'Delete a saved payment token (DELETE /v3/vault/payment-tokens/{id}). The success status code is not documented; record the real one.',
    parameters: deletePaymentTokenSchema,
    actions: { vault: { deletePaymentToken: true } },
    readOnly: false,
    execute: (client, a) => client.request('DELETE', `/v3/vault/payment-tokens/${encodeURIComponent(a.payment_token_id)}`),
  },
]
