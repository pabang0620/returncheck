import { INSPECT_PROMPT, SETTLE_PROMPT } from './prompts.js'
import { claudeTools, runTool, traceEvent } from './tools.js'

const MAX_STEPS = 24

const textOf = (content) => content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()

// Live loop over the Anthropic Messages API. `client` is injected so tests run with a fake and
// the server only builds a real client when ANTHROPIC_API_KEY is set.
export async function runClaudeAgent(ctx, phase, { client, model }) {
  const events = []
  const system = phase === 'inspect' ? INSPECT_PROMPT : SETTLE_PROMPT
  const messages = [{ role: 'user', content: phase === 'inspect' ? `Inspect the return of rental ${ctx.session.rental.id} now.` : `Settle the claim for rental ${ctx.session.rental.id} now.` }]
  const tools = claudeTools()

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const response = await client.messages.create({ model, max_tokens: 4096, system, tools, messages })
    messages.push({ role: 'assistant', content: response.content })
    if (response.stop_reason !== 'tool_use') return { reply: textOf(response.content) || 'Done.', events, source: 'claude' }

    const results = []
    for (const use of response.content.filter((b) => b.type === 'tool_use')) {
      const out = await runTool(ctx, use.name, use.input)
      events.push(traceEvent(use.name, use.input, out, 'claude'))
      results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out.result).slice(0, 12000), is_error: !out.ok })
    }
    messages.push({ role: 'user', content: results })
  }
  return { reply: 'I stopped after several steps. Staff can run me again.', events, source: 'claude' }
}
