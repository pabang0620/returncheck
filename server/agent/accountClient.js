import { config } from '../config.js'
import { loadSdk, shapeFor, withoutApiKey } from './accountSdk.js'

// A stand-in for `anthropic.messages.create` that answers one model turn through the Claude Agent SDK
// (the developer's Claude Code login, never an API key). It lets the Studio adapter and the vision request
// run unchanged. Tools are advertised but never executed here: the first tool_use the model emits is
// returned to the caller, which owns tool execution (AG Studio runs its own tools in the browser).
const SERVER_NAME = 'turn'
const PREFIX = `mcp__${SERVER_NAME}__`

const textOf = (content) => (typeof content === 'string' ? content : content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'))

// Prior turns (text, tool calls, tool results) are written into one transcript, because the SDK takes user
// input only. Images stay as image blocks in the final user content.
export function buildPrompt(messages) {
  const blocks = []
  const push = (text) => text && blocks.push({ type: 'text', text })
  const only = messages.length === 1 && messages[0].role === 'user'
  for (const m of messages) {
    const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content
    for (const b of parts) {
      if (b.type === 'image') blocks.push(b)
      else if (b.type === 'text') push(only ? b.text : `[${m.role}] ${b.text}`)
      else if (b.type === 'tool_use') push(`[assistant called tool ${b.name} with ${JSON.stringify(b.input)}]`)
      else if (b.type === 'tool_result') push(`[tool result ${b.tool_use_id}] ${textOf(b.content ?? '')}`)
    }
  }
  if (!only) push('Continue from the conversation above: give the next assistant step (call a tool or answer).')
  return blocks
}

export function createAccountClient({ sdk = null, model = config.anthropicModel } = {}) {
  return {
    kind: 'account',
    messages: {
      async create(request) {
        const agentSdk = sdk || (await loadSdk())
        const tools = (request.tools || []).map((t) => agentSdk.tool(t.name, t.description || t.name, shapeFor(t.input_schema), async () => ({ content: [{ type: 'text', text: 'recorded' }] })))
        const forced = request.tool_choice?.type === 'tool' ? request.tool_choice.name : null
        const system = [textOf(request.system || ''), forced ? `You must answer by calling the tool ${forced}.` : '', request.tool_choice?.type === 'any' ? 'You must call one of the tools.' : ''].filter(Boolean).join('\n\n')
        const content = buildPrompt(request.messages)
        const controller = new AbortController()
        const prompt = (async function* one() {
          yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
        })()
        const stream = agentSdk.query({
          prompt,
          options: {
            model, systemPrompt: system, tools: [], allowedTools: [`${PREFIX}*`], settingSources: [], persistSession: false, maxTurns: 3, effort: 'low',
            mcpServers: tools.length ? { [SERVER_NAME]: agentSdk.createSdkMcpServer({ name: SERVER_NAME, version: '1.0.0', tools }) } : {},
            env: withoutApiKey(), abortController: controller,
          },
        })
        const seen = []
        let finalText = ''
        try {
          for await (const message of stream) {
            if (message.type === 'assistant') {
              for (const b of message.message.content) {
                if (b.type === 'text') seen.push({ type: 'text', text: b.text })
                else if (b.type === 'tool_use') seen.push({ type: 'tool_use', id: b.id, name: b.name.replace(PREFIX, ''), input: b.input })
              }
            } else if (message.type === 'user' && seen.some((b) => b.type === 'tool_use')) {
              break
            } else if (message.type === 'result') {
              if (message.subtype === 'success') finalText = message.result
              else if (!seen.length) throw new Error(`Account turn failed: ${message.subtype}`)
              break
            }
          }
        } finally {
          controller.abort()
        }
        const used = seen.some((b) => b.type === 'tool_use')
        const out = used ? seen : finalText ? [{ type: 'text', text: finalText }] : seen
        return { content: out, stop_reason: used ? 'tool_use' : 'end_turn' }
      },
    },
  }
}
