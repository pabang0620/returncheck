import { randomBytes } from 'node:crypto'
import { createLiveClient, createMockClient, createVaultTools } from '../../packages/paypal-vault-tools/index.js'
import { toMoney, toDecimal } from '../domain/money.js'

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const mockId = (prefix, length = 12) => prefix + Array.from(randomBytes(length), (b) => ALNUM[b % ALNUM.length]).join('')

// Mock for the Agent Toolkit calls this app uses: get_order, create_refund, list_transactions,
// create_invoice, send_invoice. Response fields follow the PayPal REST shapes these tools return.
function createMockToolkit(vaultClient) {
  const refunds = new Map()
  const invoices = new Map()
  const transactions = []
  const disputes = new Map()
  return {
    mode: 'mock',
    async call(name, args) {
      if (name === 'get_order') return vaultClient.request('GET', `/v2/checkout/orders/${args.id}`)
      if (name === 'create_refund') {
        const refund = { id: mockId('REF'), status: 'COMPLETED', amount: args.amount, invoice_id: args.invoice_id }
        refunds.set(refund.id, { ...refund, capture_id: args.capture_id })
        transactions.push({ transaction_info: { transaction_id: refund.id, transaction_event_code: 'T1107', transaction_amount: { currency_code: 'USD', value: `-${args.amount.value}` } } })
        return refund
      }
      if (name === 'list_transactions') return { transaction_details: transactions, total_items: transactions.length }
      if (name === 'create_invoice') {
        const id = mockId('INV2-', 10)
        invoices.set(id, { id, status: 'DRAFT', ...args })
        return { id, status: 'DRAFT', href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${id}` }
      }
      if (name === 'send_invoice') {
        const invoice = invoices.get(args.invoice_id)
        if (!invoice) throw new Error('Invoice not found')
        invoices.set(args.invoice_id, { ...invoice, status: 'SENT' })
        return { id: args.invoice_id, status: 'SENT' }
      }
      // Shapes follow GET /v1/customer/disputes (summary list) and GET /v1/customer/disputes/{id} (detail).
      if (name === 'list_disputes') {
        return { items: [...disputes.values()].map(({ disputed_transactions, ...summary }) => summary), links: [] }
      }
      if (name === 'get_dispute') {
        const dispute = disputes.get(args.dispute_id)
        if (!dispute) throw new Error('PayPal get_dispute: 404 RESOURCE_NOT_FOUND')
        return dispute
      }
      throw new Error(`Toolkit tool ${name} is not mocked`)
    },
    // Mock only: lets the demo show what the watch does when a payer opens a dispute on a captured charge.
    seedDispute({ captureId, amount }) {
      const id = mockId('PP-D-', 8)
      const now = new Date().toISOString()
      disputes.set(id, {
        dispute_id: id, create_time: now, update_time: now, status: 'OPEN', dispute_state: 'REQUIRED_ACTION',
        reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', dispute_amount: amount, dispute_life_cycle_stage: 'INQUIRY',
        disputed_transactions: [{ seller_transaction_id: captureId, buyer: { name: 'Jordan Lee' } }],
      })
      return id
    },
    recordCapture(capture) {
      transactions.push({ transaction_info: { transaction_id: capture.id, transaction_event_code: 'T0006', transaction_amount: capture.amount } })
    },
  }
}

async function createLiveToolkit({ clientId, clientSecret }) {
  const { PayPalAgentToolkit } = await import('@paypal/agent-toolkit/openai')
  const toolkit = new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration: {
      actions: { orders: { get: true }, payments: { createRefund: true }, transactions: { list: true }, disputes: { list: true, get: true }, invoices: { create: true, send: true } },
      context: { sandbox: true },
    },
  })
  let counter = 0
  return {
    mode: 'sandbox',
    async call(name, args) {
      counter += 1
      const result = await toolkit.handleToolCall({ id: `call_${counter}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
      const parsed = JSON.parse(result.content)
      if (parsed?.ok === false) throw new Error(`PayPal ${name}: ${parsed.status} ${parsed.message || parsed.code}`)
      if (parsed?.error) throw new Error(`PayPal ${name}: ${typeof parsed.error === 'string' ? parsed.error : parsed.error.message || JSON.stringify(parsed.error)}`)
      return parsed
    },
  }
}

export async function createGateway({ config, vaultClient, toolkit } = {}) {
  const live = Boolean(config?.paypalClientId && config?.paypalClientSecret)
  const client = vaultClient || (live ? createLiveClient({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret }) : createMockClient())
  const kit = toolkit || (live ? await createLiveToolkit({ clientId: config.paypalClientId, clientSecret: config.paypalClientSecret }) : createMockToolkit(client))
  const vault = createVaultTools({ client })
  const calls = []

  async function run(tool, source, fn) {
    const entry = { tool, source: client.mode === 'mock' ? 'mock' : 'sandbox live', at: new Date().toISOString() }
    try {
      const result = await fn()
      calls.push({ ...entry, ok: true })
      return result
    } catch (err) {
      calls.push({ ...entry, ok: false, error: err.message })
      throw err
    }
  }

  const gateway = {
    mode: client.mode,
    client,
    vault,
    calls,
    callCount: () => calls.length,
    vaultTool: (name, args) => run(name, 'vault', () => vault.handleToolCall(name, args)),
    toolkitTool: (name, args) => run(name, 'toolkit', () => kit.call(name, args)),
    seedDemoToken(id) {
      if (client.seedToken) client.seedToken(id)
    },
    // A removed or unknown token answers with an error; any answer without a payment source counts as revoked.
    async tokenStatus(tokenId) {
      try {
        const token = await gateway.vaultTool('vault_get_payment_token', { payment_token_id: tokenId })
        return token?.payment_source ? 'active' : 'revoked'
      } catch (err) {
        if (err.status === 404 || err.status === 410) return 'revoked'
        throw err
      }
    },
    async chargeToken({ vaultId, invoiceId, requestId, items, amountCents, withStoredCredential = false }) {
      const order = await gateway.vaultTool('vault_charge_token', {
        vault_id: vaultId,
        invoice_id: invoiceId,
        request_id: requestId,
        items: items.map((i) => ({ name: i.name, description: i.description, sku: i.sku, quantity: '1', unit_amount: toMoney(i.cents) })),
        amount: toMoney(amountCents),
        with_stored_credential: withStoredCredential,
      })
      const capture = order.purchase_units?.[0]?.payments?.captures?.[0]
      if (capture && kit.recordCapture) kit.recordCapture(capture)
      return order
    },
    createRefund: ({ captureId, amountCents, note, invoiceId }) =>
      gateway.toolkitTool('create_refund', { capture_id: captureId, amount: toMoney(amountCents), note_to_payer: note, invoice_id: invoiceId }),
    getOrder: (id) => gateway.toolkitTool('get_order', { id }),
    listTransactions: (args = {}) => gateway.toolkitTool('list_transactions', args),
    // Read-only dispute watch. Nothing here can accept, answer or close a dispute.
    listDisputes: (args = {}) => gateway.toolkitTool('list_disputes', args),
    getDispute: (disputeId) => gateway.toolkitTool('get_dispute', { dispute_id: disputeId }),
    seedMockDispute(args) {
      if (!kit.seedDispute) throw new Error('Disputes can only be simulated on the mock gateway')
      return kit.seedDispute(args)
    },
    async createAndSendInvoice({ invoiceNumber, recipientEmail, items, note }) {
      const draft = await gateway.toolkitTool('create_invoice', {
        currency_code: 'USD',
        invoice_number: invoiceNumber,
        note,
        primary_recipients: [{ billing_info: { email_address: recipientEmail } }],
        items: items.map((i) => ({ name: i.name, description: i.description, quantity: '1', unit_amount: { currency_code: 'USD', value: toDecimal(i.cents) } })),
      })
      // The live toolkit answers with a link ({rel: 'self', href: '.../invoices/INV2-...'}), the mock with {id}.
      const invoiceId = draft.id || String(draft.href || '').split('/').pop()
      if (!invoiceId) throw new Error('PayPal create_invoice returned no invoice id')
      const sent = await gateway.toolkitTool('send_invoice', { invoice_id: invoiceId, send_to_recipient: true })
      return { invoiceId, status: sent.status || 'SENT' }
    },
    deleteToken: (tokenId) => gateway.vaultTool('vault_delete_payment_token', { payment_token_id: tokenId }),
  }
  return gateway
}
