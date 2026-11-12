// claude-sonnet-5-5 rejects forced tool_choice ("tool" and "any" return HTTP 400). Requests therefore never carry
// tool_choice; a system instruction asks for the tool instead, and the answer is checked after the call.
export const ANY_TOOL = Symbol('any-tool')

const instructionFor = (required) => (required === ANY_TOOL ? 'You must call one of the tools in this turn.' : `You must answer by calling the tool ${required}.`)

// Returns a copy of the request without tool_choice and with the instruction added to the system prompt.
export function withRequiredTool(request, required, { repeat = false } = {}) {
  const { tool_choice: _dropped, ...rest } = request
  if (!required) return rest
  const line = repeat ? `Reminder: your last answer did not call the tool. ${instructionFor(required)}` : instructionFor(required)
  const system = [typeof rest.system === 'string' ? rest.system : '', line].filter(Boolean).join('\n\n')
  return { ...rest, system }
}

export function calledRequiredTool(response, required) {
  const blocks = Array.isArray(response?.content) ? response.content : []
  return blocks.some((b) => b.type === 'tool_use' && (required === ANY_TOOL || b.name === required))
}

// One call, then one retry with the instruction repeated. Returns the response, or null when the model still
// did not call the tool (the caller then uses its labelled fallback).
export async function createRequiringTool(anthropic, request, required) {
  const first = await anthropic.messages.create(withRequiredTool(request, required))
  if (!required || calledRequiredTool(first, required)) return first
  const second = await anthropic.messages.create(withRequiredTool(request, required, { repeat: true }))
  return calledRequiredTool(second, required) ? second : null
}
