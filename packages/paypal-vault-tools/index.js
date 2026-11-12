import { z } from 'zod'
import { VAULT_TOOLS } from './tools.js'

export { createLiveClient, createMockClient, PayPalApiError } from './clients.js'
export { VAULT_TOOLS }

export const vaultToolNames = VAULT_TOOLS.map((t) => t.name)

// Tools that cannot move money or change a saved token: the only ones a model may be given.
export const readOnlyVaultTools = VAULT_TOOLS.filter((t) => t.readOnly)

// Bind the tools to a client. Returns toolkit-shaped tool descriptors and a dispatcher.
export function createVaultTools({ client, tools = VAULT_TOOLS }) {
  const byName = new Map(tools.map((t) => [t.name, t]))
  return {
    tools: tools.map(({ execute, readOnly, ...shape }) => shape),
    async handleToolCall(name, args) {
      const tool = byName.get(name)
      if (!tool) throw new Error(`Unknown Vault tool ${name}`)
      return tool.execute(client, tool.parameters.parse(args))
    },
    // OpenAI function-calling shape, like toolkit.getTools() from @paypal/agent-toolkit/openai.
    toOpenAITools() {
      return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: toJsonSchema(t.parameters) } }))
    },
    // Anthropic tool shape.
    toClaudeTools() {
      return tools.map((t) => ({ name: t.name, description: t.description, input_schema: toJsonSchema(t.parameters) }))
    },
  }
}

export function toJsonSchema(schema) {
  const { $schema, ...rest } = z.toJSONSchema(schema, { io: 'input' })
  return rest
}
