# paypal-vault-tools

Six PayPal Vault v3 tools in the same shape as the tools in `@paypal/agent-toolkit`: `method`, `name`, `description`, zod `parameters`, `actions`, plus an `execute(client, args)` function.

This is a separate bundle that copies the toolkit's shape. It is not a plug-in for a toolkit extension point (the toolkit 1.11.0 has none and no `/v3/vault` calls). It is local to this repository and not published to npm.

| Tool | Call | Read-only |
|---|---|---|
| `vault_create_setup_token` | `POST /v3/vault/setup-tokens` | no |
| `vault_create_payment_token` | `POST /v3/vault/payment-tokens` | no |
| `vault_get_payment_token` | `GET /v3/vault/payment-tokens/{id}` | yes |
| `vault_list_customer_tokens` | `GET /v3/vault/payment-tokens?customer_id=` | yes |
| `vault_charge_token` | `POST /v2/checkout/orders` (CAPTURE, `vault_id`, `items`, `invoice_id`, `PayPal-Request-Id`) | no |
| `vault_delete_payment_token` | `DELETE /v3/vault/payment-tokens/{id}` | no |

Money tools take the amount from the caller and check that the items add up to it. Do not give them to a model: `readOnlyVaultTools` is the only list meant for that.

## One tool loop with the Agent Toolkit

```js
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/openai'
import { createLiveClient, createVaultTools } from 'paypal-vault-tools'

const toolkit = new PayPalAgentToolkit({ clientId, clientSecret, configuration: { actions: { orders: { get: true }, payments: { createRefund: true } }, context: { sandbox: true } } })
const vault = createVaultTools({ client: createLiveClient({ clientId, clientSecret }) })

// Toolkit tools and Vault tools in one array, same OpenAI function shape.
const tools = [...toolkit.getTools(), ...vault.toOpenAITools()]

async function run(call) {
  const name = call.function.name
  const args = JSON.parse(call.function.arguments)
  return name.startsWith('vault_') ? vault.handleToolCall(name, args) : toolkit.handleToolCall(call)
}
```

For Claude use `vault.toClaudeTools()` (`name`, `description`, `input_schema`).

## Clients

- `createLiveClient({ clientId, clientSecret, fetchImpl })`: sandbox host `api-m.sandbox.paypal.com`, OAuth client credentials, `PayPal-Request-Id` support. `fetchImpl` is injectable for tests.
- `createMockClient()`: same response shapes (setup token `PAYER_ACTION_REQUIRED` with approve link, payment token with `customer.id`, order `COMPLETED` with a capture). Idempotent per `PayPal-Request-Id`. `revokeToken`, `loseNextResponse` and `seedToken` simulate edge cases.

Unverified against the sandbox (see `VERIFY.md` in the app root): `UNSCHEDULED_POSTPAID` acceptance, the DELETE success code, the answer for a token the payer removed, and whether merchant-initiated charges need risk data.
