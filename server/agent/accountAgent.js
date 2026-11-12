import { config } from '../config.js'
import { INSPECT_PROMPT, SETTLE_PROMPT } from './prompts.js'
import { loadSdk, shapeFor, withoutApiKey } from './accountSdk.js'
import { claudeTools, runTool, traceEvent } from './tools.js'

// Local development only: the same tools, prompts and result shape as the API loop in claudeAgent.js, run
// through the Claude Agent SDK on the developer's Claude Code login. Enabled with LLM_BACKEND=account.
const SERVER_NAME = 'returncheck'
const MAX_TURNS = 24

function buildServer({ tool, createSdkMcpServer }, ctx, events) {
  const tools = claudeTools().map((def) =>
    tool(def.name, def.description, shapeFor(def.input_schema), async (input) => {
      const out = await runTool(ctx, def.name, input)
      events.push(traceEvent(def.name, input, out, 'claude'))
      return { content: [{ type: 'text', text: JSON.stringify(out.result).slice(0, 12000) }], isError: !out.ok }
    }),
  )
  return createSdkMcpServer({ name: SERVER_NAME, version: '1.0.0', tools })
}

export async function runAccountAgent(ctx, phase, { sdk = null, model = config.anthropicModel } = {}) {
  const agentSdk = sdk || (await loadSdk())
  const events = []
  const texts = []
  let reply = ''
  const stream = agentSdk.query({
    prompt: phase === 'inspect' ? `Inspect the return of rental ${ctx.session.rental.id} now.` : `Settle the claim for rental ${ctx.session.rental.id} now.`,
    options: {
      model,
      systemPrompt: phase === 'inspect' ? INSPECT_PROMPT : SETTLE_PROMPT,
      tools: [],
      allowedTools: [`mcp__${SERVER_NAME}__*`],
      mcpServers: { [SERVER_NAME]: buildServer(agentSdk, ctx, events) },
      maxTurns: MAX_TURNS,
      effort: 'medium',
      settingSources: [],
      persistSession: false,
      env: withoutApiKey(),
    },
  })
  for await (const message of stream) {
    if (message.type === 'assistant') {
      const said = (message.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
      if (said) texts.push({ at: new Date().toISOString(), text: said })
      continue
    }
    if (message.type !== 'result') continue
    if (message.subtype === 'success') reply = message.result
    else if (message.subtype === 'error_max_turns') reply = 'I stopped after several steps. Staff can run me again.'
    else throw new Error(`Account agent failed: ${message.subtype}`)
  }
  return { reply: reply?.trim() || 'Done.', events, texts, source: 'claude' }
}
