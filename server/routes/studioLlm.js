import { readFileSync } from 'node:fs'
// Translates AG Studio's LLM adapter requests (Responses-style conversation items) to the Anthropic
// Messages API and back. AG Studio ships no Claude adapter, so this mapping is ours.
const textBlock = (text) => ({ type: 'text', text })

function pushMessage(messages, role, blocks) {
  const last = messages[messages.length - 1]
  if (last && last.role === role) last.content = [...last.content, ...blocks]
  else messages.push({ role, content: blocks })
}

export function toAnthropicRequest({ instructions, input = [], tools = [], toolChoice = 'auto', responseFormat = { type: 'text' } }) {
  const system = [instructions].filter(Boolean)
  const messages = []
  for (const item of input) {
    if (item.type === 'message' && item.role === 'system') {
      system.push(item.content.map((c) => c.text || '').join('\n'))
    } else if (item.type === 'message' && item.role === 'user') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
      pushMessage(messages, 'user', [textBlock(text || '(empty)')])
    } else if (item.type === 'message' && item.role === 'assistant') {
      const text = item.content.map((c) => (c.type === 'text' ? c.text : c.refusal || '')).join('\n')
      if (text) pushMessage(messages, 'assistant', [textBlock(text)])
    } else if (item.type === 'function_call') {
      let args = {}
      try { args = JSON.parse(item.arguments || '{}') } catch { args = {} }
      pushMessage(messages, 'assistant', [{ type: 'tool_use', id: item.callId, name: item.name, input: args }])
    } else if (item.type === 'function_call_output') {
      pushMessage(messages, 'user', [{ type: 'tool_result', tool_use_id: item.callId, content: String(item.output ?? '') }])
    }
  }
  const anthropicTools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters?.type === 'object' ? t.parameters : { type: 'object', properties: {} } }))
  const request = { system: system.join('\n\n'), messages, tools: anthropicTools }
  if (responseFormat.type === 'json') {
    request.tools = [...anthropicTools, { name: 'respond_json', description: responseFormat.description || 'Return the final JSON answer', input_schema: responseFormat.schema }]
    request.tool_choice = { type: 'tool', name: 'respond_json' }
  } else if (toolChoice === 'none') {
    request.tools = []
  } else if (toolChoice === 'required') {
    request.tool_choice = { type: 'any' }
  } else if (typeof toolChoice === 'object' && toolChoice.name) {
    request.tool_choice = { type: 'tool', name: toolChoice.name }
  }
  if (!request.tools.length) delete request.tools
  return request
}

let counter = 0
const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(counter += 1)}`

export function fromAnthropicContent(content, { json = false } = {}) {
  const output = []
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      output.push({ id: nextId('msg'), kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: block.text, annotations: [] }] })
    } else if (block.type === 'tool_use' && json && block.name === 'respond_json') {
      output.push({ id: nextId('msg'), kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: JSON.stringify(block.input), annotations: [] }] })
    } else if (block.type === 'tool_use') {
      output.push({ id: nextId('fc'), kind: 'output', type: 'function_call', callId: block.id, name: block.name, arguments: JSON.stringify(block.input || {}), status: 'completed' })
    }
  }
  return output
}

export const RECORDED_REPLY = 'No model is connected in this demo, so this is a fixed note, not a model answer. One real Claude Sonnet run was recorded: use the first starter, "Recovery by gear", to see a bar chart built from a recorded Claude session. With a live model the Damage Analyst reads the data and asks the widget agent to build any chart. Try the damage map: click a zone to filter every widget.'

export function recordedOutput() {
  return [{ id: nextId('msg'), kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: RECORDED_REPLY, annotations: [] }] }]
}

// Recorded run: the turns a live Claude produced for the "Recovery by gear" prompt (V10), replayed through the
// same adapter path. AG Studio executes the tool calls itself, so the widget is really added to the dashboard.
const recording = JSON.parse(readFileSync(new URL('../demo/studioRecording.json', import.meta.url), 'utf8')).turns
const firstUserText = (input = []) => {
  const m = input.find((i) => i.type === 'message' && i.role === 'user')
  return m ? m.content.map((c) => c.text || '').join('') : ''
}

export function recordedTurn(body) {
  const prompt = firstUserText(body.input)
  const hit = recording.find((t) => t.prompt === prompt && t.inputLength === (body.input || []).length)
  return hit ? hit.output : null
}

export async function runStudioTurn(body, { anthropic, model }) {
  if (!anthropic) return { source: 'recorded', output: recordedTurn(body) || recordedOutput() }
  const request = toAnthropicRequest(body)
  const response = await anthropic.messages.create({ model, max_tokens: 4096, ...request })
  return { source: 'claude', output: fromAnthropicContent(response.content, { json: body.responseFormat?.type === 'json' }) }
}
